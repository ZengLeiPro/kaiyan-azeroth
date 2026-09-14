import { resolveFinanceAccountCodeByBankName } from '@ky-azeroth/shared/constants';
import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';

/**
 * CRM 回款 ↔ 财务流水自动同步服务（绑定方案 v2.2）
 *
 * v2.1 → v2.2 关键改造：
 *  - 输入仍然是 paymentId（外部 7 个接入点签名不变）
 *  - 内部改为按 PaymentItem 遍历派生 N 条 ledger（一笔 payment 拆 N 产品 × N 科目 × N mode）
 *  - paymentMode ∈ {dingtalk_collect, pass_through_cost} 跳过 ledger 派生
 *  - paymentMode ∈ {direct, pass_through} → 派生 ledger，subject 来源 PaymentItem.financeSubjectId
 *  - 1:1 主轴从 paymentId 移到 paymentItemId（schema migration 已落 paymentItemId @unique）
 *
 * 触发点（全部同事务调用，外部接入点未变）：
 *  1. approvals.service.updateBusinessStatus 'payment_approve' status='approved'
 *  2. approvals.service.updateBusinessStatus 'payment_refund_approve' status='approved'
 *  3. approvals.service.updateBusinessStatusToDraft 'payment_approve'（撤回）
 *  4. approvals.service.updateBusinessStatusToDraft 'payment_refund_approve'（撤回）
 *  5. approval-change-requests.service handlePaymentChangeApproved（变更审批通过）
 *  6. payments.service.remove 已 approved 软删
 *
 * Feature flag：`AUTO_LEDGER_FROM_PAYMENT=true` 才执行写入，默认 false → 静默 no-op。
 *
 * 不变量：
 *  - source='crm_payment' 标识派生 ledger，与手工 (manual) / 钉钉 (dingtalk_import) 物理隔离
 *  - 1 PaymentItem ↔ 0..1 ledger（`finance_ledgers.paymentItemId` 上的 @unique 强制）
 *  - 1 Payment ↔ 0..N ledger（去掉了 v2.1 的 paymentId @unique 强约束）
 *  - direction 派生：Payment.IN → ledger.in（+amount）/ Payment.OUT → ledger.out（-amount）
 *  - 兜底科目 code='non_pl.uncategorized'，admin 在 finance-ledger UI 批量改科目
 *  - 撤回不 hard delete，软删 + 复活（再次审批通过会 deletedAt=null）
 */
@Injectable()
export class FinanceLedgerSyncService {
  private readonly logger = new Logger(FinanceLedgerSyncService.name);

  private cachedFallbackSubjectId: string | null = null;

  // paymentMode 黑名单：这些 mode 不派生 ledger
  private static readonly MODE_SKIP_LEDGER = new Set(['dingtalk_collect', 'pass_through_cost']);

  constructor(private readonly config: ConfigService) {}

  /**
   * Feature flag 检查
   * - 默认 false（任何非 'true'/'1' 字符串都视作关闭）
   * - 关时所有公开方法静默 return，不抛错，不写库
   */
  private isEnabled(): boolean {
    const v = this.config.get<string>('AUTO_LEDGER_FROM_PAYMENT');
    return v === 'true' || v === '1';
  }

  /**
   * Payment 审批通过 / 变更审批通过 / 撤回后复活 → 写 / 更新派生 ledger（多条）
   *
   * 调用语义：
   *  - 仅在 payment.flowStatus='approved' 时落地写入
   *  - 按 paymentItems 遍历：mode 在黑名单跳过；direct/pass_through 派生 ledger
   *  - 已存在 ledger 时（按 paymentItemId 匹配）：保留 subjectId（admin 可能手改过），仅更新金额/账户/日期/方向
   *  - 不存在 ledger 时：创建，subjectId 走 PaymentItem.financeSubjectId ?? 兜底 链路
   *  - 反向：清理已不存在的 PaymentItem 对应的孤儿 ledger（admin 删了某 item）
   *
   * 错误处理：
   *  - financeAccountId 缺失 → BadRequestException（让审批回退）
   *  - payment 不存在 → BadRequestException
   *  - payment.paymentItems 为空（历史回填窗口期）→ 跳过派生但不抛错（warn 日志）
   */
  async syncFromPayment(tx: Prisma.TransactionClient, paymentId: string): Promise<void> {
    if (!this.isEnabled()) return;

    const payment = await tx.payment.findUnique({
      where: { id: paymentId },
      select: {
        id: true,
        serialNumber: true,
        saleOrderId: true,
        paymentAmount: true,
        direction: true,
        flowStatus: true,
        businessDate: true,
        financeAccountId: true,
        bankName: true,
        chargerId: true,
        creatorEmployeeId: true,
        updaterEmployeeId: true,
        deletedAt: true,
        saleOrder: { select: { id: true, serialNumber: true, orderTitle: true } },
        paymentItems: {
          where: { deletedAt: null },
          select: {
            id: true,
            itemSeq: true,
            productName: true,
            amount: true,
            financeSubjectId: true,
            paymentMode: true,
          },
          orderBy: { itemSeq: 'asc' },
        },
      },
    });
    if (!payment) {
      throw new BadRequestException(`同步派生流水：回款 ${paymentId} 不存在`);
    }
    if (payment.deletedAt) {
      this.logger.warn(`同步派生流水：回款 ${paymentId} 已软删，跳过`);
      return;
    }
    if (payment.flowStatus !== 'approved') {
      this.logger.warn(
        `同步派生流水：回款 ${paymentId} flowStatus=${payment.flowStatus} 非 approved，跳过`
      );
      return;
    }
    // v2.2 PR-C 懒迁移：historical payment 可能 financeAccountId=null 但 bankName 有值，
    // 在此自动按 bankName 反查补一次，避免老 payment 撤回再审批时 syncFromPayment 直接爆。
    // 命中映射且 finance_account 存在 → 同事务 update + 内存对象同步；
    // 不命中 → 仍走原 throw。
    if (!payment.financeAccountId && payment.bankName) {
      const lazyAccountId = await this.lazyResolveFinanceAccountIdByBankName(tx, payment.bankName);
      if (lazyAccountId) {
        await tx.payment.update({
          where: { id: payment.id },
          data: { financeAccountId: lazyAccountId },
        });
        payment.financeAccountId = lazyAccountId;
        this.logger.warn(
          `懒迁移：回款 ${payment.serialNumber} 自动补 financeAccountId=${lazyAccountId}（按 bankName=${payment.bankName}）`
        );
      }
    }
    if (!payment.financeAccountId) {
      throw new BadRequestException(
        `回款 ${payment.serialNumber} 未指定收款账户（financeAccountId）`
      );
    }
    if (!payment.businessDate) {
      throw new BadRequestException(`回款 ${payment.serialNumber} 缺少业务日期，无法落账`);
    }
    if (payment.paymentItems.length === 0) {
      this.logger.warn(
        `同步派生流水：回款 ${payment.serialNumber} 无 PaymentItem 子项，跳过派生（历史回填窗口期可能未补全）`
      );
      return;
    }

    const direction = payment.direction === 'OUT' ? 'out' : 'in';
    const sign = payment.direction === 'OUT' ? -1 : 1;
    const remarkBase = this.buildRemarkBase(
      payment.serialNumber,
      payment.saleOrder?.orderTitle ?? null
    );

    // 派生 / 更新：逐个 PaymentItem
    let createdCount = 0;
    let updatedCount = 0;
    let skippedByMode = 0;
    const liveItemIds: string[] = [];

    for (const item of payment.paymentItems) {
      if (FinanceLedgerSyncService.MODE_SKIP_LEDGER.has(item.paymentMode)) {
        skippedByMode += 1;
        continue;
      }
      if (item.amount.lte(0)) {
        this.logger.warn(
          `同步派生流水：回款 ${payment.serialNumber} item#${item.itemSeq} 金额 <= 0，跳过`
        );
        continue;
      }

      liveItemIds.push(item.id);

      // 检查现有 ledger（按 paymentItemId 1:1）
      const existing = await tx.financeLedger.findUnique({
        where: { paymentItemId: item.id },
        select: { id: true, subjectId: true, deletedAt: true },
      });

      // 金额 + 方向
      const amount = item.amount.mul(sign);
      // remark 含产品名
      const remark = `${remarkBase} - ${item.productName}`.slice(0, 500);

      if (existing) {
        // 已存在派生 ledger：保留 admin 可能改过的 subjectId
        const shouldOverwriteSubject = existing.deletedAt && item.financeSubjectId ? true : false;
        const subjectId = shouldOverwriteSubject ? item.financeSubjectId! : existing.subjectId;

        await tx.financeLedger.update({
          where: { paymentItemId: item.id },
          data: {
            txDate: payment.businessDate,
            accountId: payment.financeAccountId,
            subjectId,
            amount,
            direction,
            remark,
            deletedAt: null, // 撤回后复活
            paymentId: payment.id,
            saleOrderId: payment.saleOrderId,
            updaterEmployeeId: payment.updaterEmployeeId ?? payment.chargerId ?? null,
          },
        });
        updatedCount += 1;
        continue;
      }

      // 新建派生 ledger
      const subjectId = item.financeSubjectId ?? (await this.resolveFallbackSubjectId(tx));

      await tx.financeLedger.create({
        data: {
          txDate: payment.businessDate,
          accountId: payment.financeAccountId,
          subjectId,
          amount,
          direction,
          remark,
          source: 'crm_payment',
          paymentId: payment.id,
          paymentItemId: item.id,
          saleOrderId: payment.saleOrderId,
          creatorEmployeeId: payment.chargerId ?? payment.creatorEmployeeId ?? null,
        },
      });
      createdCount += 1;
    }

    // 反向：清理已不存在的 PaymentItem 对应的孤儿 ledger（admin 删了某 item 或改了 mode 到 skip 列表）
    const orphanResult = await tx.financeLedger.updateMany({
      where: {
        paymentId: payment.id,
        source: 'crm_payment',
        deletedAt: null,
        paymentItemId: liveItemIds.length ? { notIn: liveItemIds } : { not: null }, // 全部 item 都被删 / 都是 skip mode → 软删所有派生
      },
      data: { deletedAt: new Date() },
    });

    this.logger.log(
      `派生流水同步：payment=${payment.serialNumber} created=${createdCount} updated=${updatedCount} skippedByMode=${skippedByMode} orphanRevoked=${orphanResult.count}`
    );
  }

  /**
   * Payment 撤回审批 / 已 approved 删除 → 软删所有派生 ledger
   *
   * v2.1 → v2.2 改造：从 1:1 单条软删变为 1:N updateMany 软删
   *
   * 调用语义：
   *  - 派生 ledger 不存在 / 全已软删 → no-op（计数=0）
   *  - 存活的派生 ledger → 全部软删 + 追加原因到 remark
   */
  async revokeFromPayment(
    tx: Prisma.TransactionClient,
    paymentId: string,
    reason: string
  ): Promise<void> {
    // 查所有存活的派生 ledger（1:N）
    const existing = await tx.financeLedger.findMany({
      where: {
        paymentId,
        source: 'crm_payment',
        deletedAt: null,
      },
      select: { id: true, remark: true },
    });
    if (existing.length === 0) {
      this.logger.warn(`派生流水撤销：payment=${paymentId} 无存活派生 ledger，跳过`);
      return;
    }

    // 逐条更新 remark + deletedAt（updateMany 不支持基于现有字段拼接，必须逐条）
    const now = new Date();
    for (const led of existing) {
      const newRemark = led.remark ? `${led.remark} | ${reason}` : reason;
      await tx.financeLedger.update({
        where: { id: led.id },
        data: {
          deletedAt: now,
          remark: newRemark.slice(0, 500),
        },
      });
    }

    this.logger.log(
      `派生流水撤销：payment=${paymentId} revoked=${existing.length} reason=${reason}`
    );
  }

  // ============== 私有 ==============

  private buildRemarkBase(serialNumber: string, orderTitle: string | null): string {
    const base = orderTitle ? `${serialNumber} - ${orderTitle}` : serialNumber;
    return `[CRM] ${base}`;
  }

  /**
   * v2.2 PR-C：懒迁移用 — 按 bankName 反查 finance_account.id
   *
   * 命中映射表 + DB 有该 code 的 finance_account → 返回 id；
   * 不命中（bankName 为空 / 不在映射 / DB 找不到） → 返回 null，由调用方决定降级。
   */
  private async lazyResolveFinanceAccountIdByBankName(
    tx: Prisma.TransactionClient,
    bankName: string | null | undefined
  ): Promise<string | null> {
    const code = resolveFinanceAccountCodeByBankName(bankName);
    if (!code) return null;
    const acc = await tx.financeAccount.findFirst({
      where: { code, deletedAt: null },
      select: { id: true },
    });
    return acc?.id ?? null;
  }

  /**
   * 兜底科目（待归类）id，缓存避免每次查询。
   * 找不到时抛错（生产环境应当 seed 过该科目）。
   */
  private async resolveFallbackSubjectId(tx: Prisma.TransactionClient): Promise<string> {
    if (this.cachedFallbackSubjectId) return this.cachedFallbackSubjectId;

    const subject = await tx.financeSubject.findUnique({
      where: { code: 'non_pl.uncategorized' },
      select: { id: true },
    });
    if (!subject) {
      throw new BadRequestException(
        '同步派生流水：兜底科目 non_pl.uncategorized 未找到，请先 seed finance_subjects'
      );
    }
    this.cachedFallbackSubjectId = subject.id;
    return subject.id;
  }
}
