import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';

import { PrismaService } from '../../../common/prisma/prisma.service';

/**
 * OrderProduct.totalReceivedAmount 反向缓存维护服务（绑定方案 v2.2 Phase 3）
 *
 * 缓存口径：
 *   OrderProduct.totalReceivedAmount
 *     = Σ PaymentItem.amount
 *       WHERE saleOrderProductId = OrderProduct.id
 *         AND PaymentItem.deletedAt IS NULL
 *         AND Payment.flowStatus = 'approved'
 *         AND Payment.legacyAdjustment = false
 *         AND Payment.deletedAt IS NULL
 *
 * 维护策略：
 *  - 实时刷新：PaymentItem CRUD（创建/改 amount/改 saleOrderProductId/软删）+ Payment 撤回/软删
 *    （Phase 12 前端 UX 时接入，本 service 提供算法层）
 *  - 全表对账：每天 03:00 watchdog cron 跑 auditFullTable
 *  - 备灾 reconcile：管理员 POST /finance/reconcile-order-product-receivables
 *
 * 不受 FEATURE_FLAG AUTO_LEDGER_FROM_PAYMENT 控制——这是数据一致性基础设施，
 * 跟 FinanceLedgerSyncService 解耦。
 */

export interface ReceivableDelta {
  orderProductId: string;
  /** 缓存值（即将被覆盖） */
  cached: string;
  /** 实时聚合算出的真值 */
  computed: string;
  /** computed - cached（绝对值 < 0.01 视为同步） */
  delta: string;
}

export interface AuditResult {
  /** 扫描的 OrderProduct 总数 */
  checked: number;
  /** 失同步条目（|delta| >= 0.01） */
  outOfSync: ReceivableDelta[];
}

export interface ReconcileResult extends AuditResult {
  /** 实际更新数（dryRun=true 时为 0） */
  fixed: number;
  dryRun: boolean;
}

const EPSILON = new Decimal('0.01');

@Injectable()
export class OrderProductReceivableService {
  private readonly logger = new Logger(OrderProductReceivableService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * 实时刷新：按 saleOrderProductId 重新聚合并写回 OP.totalReceivedAmount
   *
   * 同事务调用（tx 可为 PrismaTransactionClient 或 PrismaService 单条）
   * 返回 {old, new, delta}，便于调用方记日志或上抛
   */
  async recalculateForOrderProduct(
    tx: Prisma.TransactionClient | PrismaService,
    orderProductId: string
  ): Promise<{ old: Decimal; new: Decimal; delta: Decimal }> {
    const op = await tx.orderProduct.findUnique({
      where: { id: orderProductId },
      select: { id: true, totalReceivedAmount: true, deletedAt: true },
    });
    if (!op || op.deletedAt) {
      // 软删的 OP 不维护缓存（防御性，调用方不应传软删 id 进来）
      return { old: new Decimal(0), new: new Decimal(0), delta: new Decimal(0) };
    }

    const computed = await this.computeForOrderProduct(tx, orderProductId);

    await tx.orderProduct.update({
      where: { id: orderProductId },
      data: { totalReceivedAmount: computed },
    });

    return {
      old: op.totalReceivedAmount,
      new: computed,
      delta: computed.minus(op.totalReceivedAmount),
    };
  }

  /**
   * 批量刷新：去重后逐条调用 recalculateForOrderProduct
   * （Prisma 不支持单条 update SQL 中嵌 aggregate，只能一行一次）
   */
  async recalculateBatch(
    tx: Prisma.TransactionClient | PrismaService,
    orderProductIds: Array<string | null | undefined>
  ): Promise<{ updated: number }> {
    const unique = Array.from(new Set(orderProductIds.filter((x): x is string => !!x)));
    let updated = 0;
    for (const id of unique) {
      const r = await this.recalculateForOrderProduct(tx, id);
      if (!r.delta.eq(0)) updated += 1;
    }
    return { updated };
  }

  /**
   * 给定 payment id，找出其所有 PaymentItem 关联的 saleOrderProductId，批量刷新
   *
   * 注意：包括已软删的 PaymentItem——因为撤回/软删触发时，需要把"原本算进 OP 的金额"还回去
   */
  async recalculateForPayment(
    tx: Prisma.TransactionClient | PrismaService,
    paymentId: string
  ): Promise<{ updated: number }> {
    const items = await tx.paymentItem.findMany({
      where: { paymentId },
      select: { saleOrderProductId: true },
    });
    const ids = items.map((i) => i.saleOrderProductId);
    return this.recalculateBatch(tx, ids);
  }

  /**
   * 全表对账：扫所有 active OrderProduct，对比 cache vs 真值
   *
   * watchdog cron 用；不写库。
   */
  async auditFullTable(): Promise<AuditResult> {
    const ops = await this.prisma.orderProduct.findMany({
      where: { deletedAt: null },
      select: { id: true, totalReceivedAmount: true },
    });

    const outOfSync: ReceivableDelta[] = [];
    let checked = 0;
    for (const op of ops) {
      checked += 1;
      const computed = await this.computeForOrderProduct(this.prisma, op.id);
      const delta = computed.minus(op.totalReceivedAmount).abs();
      if (delta.gte(EPSILON)) {
        outOfSync.push({
          orderProductId: op.id,
          cached: op.totalReceivedAmount.toFixed(2),
          computed: computed.toFixed(2),
          delta: computed.minus(op.totalReceivedAmount).toFixed(2),
        });
      }
    }
    this.logger.log(`auditFullTable: checked=${checked}, outOfSync=${outOfSync.length}`);
    return { checked, outOfSync };
  }

  /**
   * Reconcile endpoint 调用入口（dryRun 或实际修复）
   *
   * @param orderProductIds 选定 ids；不传 = 全表
   * @param dryRun true 时仅汇报失同步，不写库；false 时同事务修复
   */
  async reconcile(opts: { orderProductIds?: string[]; dryRun: boolean }): Promise<ReconcileResult> {
    const { orderProductIds, dryRun } = opts;

    let targets: Array<{ id: string; totalReceivedAmount: Decimal }>;
    if (orderProductIds && orderProductIds.length > 0) {
      // 限定范围
      targets = await this.prisma.orderProduct.findMany({
        where: { id: { in: orderProductIds }, deletedAt: null },
        select: { id: true, totalReceivedAmount: true },
      });
    } else {
      // 全表
      targets = await this.prisma.orderProduct.findMany({
        where: { deletedAt: null },
        select: { id: true, totalReceivedAmount: true },
      });
    }

    const outOfSync: ReceivableDelta[] = [];
    for (const op of targets) {
      const computed = await this.computeForOrderProduct(this.prisma, op.id);
      const delta = computed.minus(op.totalReceivedAmount).abs();
      if (delta.gte(EPSILON)) {
        outOfSync.push({
          orderProductId: op.id,
          cached: op.totalReceivedAmount.toFixed(2),
          computed: computed.toFixed(2),
          delta: computed.minus(op.totalReceivedAmount).toFixed(2),
        });
      }
    }

    let fixed = 0;
    if (!dryRun && outOfSync.length > 0) {
      // 实际修复（单事务）
      await this.prisma.$transaction(
        async (tx) => {
          for (const row of outOfSync) {
            await tx.orderProduct.update({
              where: { id: row.orderProductId },
              data: { totalReceivedAmount: new Decimal(row.computed) },
            });
          }
        },
        { timeout: 120_000, maxWait: 10_000 }
      );
      fixed = outOfSync.length;
      this.logger.log(`reconcile: fixed ${fixed} 行失同步`);
    }

    return {
      checked: targets.length,
      outOfSync,
      fixed,
      dryRun,
    };
  }

  // ============== 私有 ==============

  /**
   * 按口径聚合：Σ PaymentItem.amount 满足约束
   *
   * 注意：aggregate 的 where.payment 在 Prisma 中需要嵌套 relation filter
   */
  private async computeForOrderProduct(
    tx: Prisma.TransactionClient | PrismaService,
    orderProductId: string
  ): Promise<Decimal> {
    const result = await tx.paymentItem.aggregate({
      where: {
        saleOrderProductId: orderProductId,
        deletedAt: null,
        payment: {
          flowStatus: 'approved',
          legacyAdjustment: false,
          deletedAt: null,
        },
      },
      _sum: { amount: true },
    });
    return result._sum.amount ?? new Decimal(0);
  }
}
