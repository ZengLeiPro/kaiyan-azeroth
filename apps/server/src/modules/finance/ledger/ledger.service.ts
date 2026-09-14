import type { FinanceLedgerResponseOutput } from '@ky-azeroth/shared/schemas';
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';

import type { PaginatedResponse } from '../../../common/interfaces/pagination.interface';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { auditCreate, auditUpdate } from '../../../common/utils/audit-helper';
import { serializeEntity, toDecimalNumber } from '../../../common/utils/response-helpers';
import { CreateFinanceLedgerDto } from './dto/create-ledger.dto';
import { QueryFinanceLedgerDto } from './dto/query-ledger.dto';
import { UpdateFinanceLedgerDto } from './dto/update-ledger.dto';

type CurrentUser = { id: string; employeeId?: string | null };

// 派生 ledger（paymentId IS NOT NULL）禁止直接修改的字段
// 此清单与「CRM 回款 ↔ 财务流水绑定方案 v2.1」一致
const DERIVED_LEDGER_LOCKED_FIELDS = new Set<keyof UpdateFinanceLedgerDto>([
  'txDate',
  'accountId',
  'amount',
  'direction',
]);

@Injectable()
export class FinanceLedgerService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(
    query: QueryFinanceLedgerDto
  ): Promise<PaginatedResponse<FinanceLedgerResponseOutput>> {
    const {
      page = 1,
      pageSize = 100,
      startDate,
      endDate,
      year,
      month,
      accountId,
      subjectId,
      category,
      direction,
      source,
      importBatchId,
      keyword,
    } = query;

    // 时间范围统一计算
    const { gte, lt } = computeDateRange(startDate, endDate, year, month);

    const where: Prisma.FinanceLedgerWhereInput = { deletedAt: null };
    if (gte || lt) where.txDate = { ...(gte && { gte }), ...(lt && { lt }) };
    if (accountId?.length) where.accountId = { in: accountId };
    if (subjectId?.length) where.subjectId = { in: subjectId };
    if (category?.length) where.subject = { category: { in: category } };
    if (direction) where.direction = direction;
    if (source?.length) where.source = { in: source };
    if (importBatchId) where.importBatchId = importBatchId;
    if (keyword) {
      where.OR = [
        { remark: { contains: keyword, mode: 'insensitive' } },
        { subject: { name: { contains: keyword, mode: 'insensitive' } } },
      ];
    }

    // runningBalance 必须按全表（所有过滤前的）累加得到。
    // 但流水量小（≤2000 行/年 × 多年也就 ≤6000），全表累加在 service 层做：
    // 1. 拿到全部 accountId 涉及的 ledger 行（按 txDate, id 排序）
    // 2. 累加 runningBalance 注入到行字典
    // 3. 再过滤 + 分页输出
    const accountsScope = (accountId?.length ?? 0 > 0) ? accountId : undefined; // 没指定就全账户
    const allOrdered = await this.prisma.financeLedger.findMany({
      where: {
        deletedAt: null,
        ...(accountsScope && { accountId: { in: accountsScope } }),
      },
      orderBy: [{ accountId: 'asc' }, { txDate: 'asc' }, { id: 'asc' }],
      select: { id: true, accountId: true, amount: true },
    });
    const runningByLedgerId = new Map<string, number>();
    const runningByAccount = new Map<string, number>();
    for (const row of allOrdered) {
      const prev = runningByAccount.get(row.accountId) ?? 0;
      const next = round2(prev + toDecimalNumber(row.amount));
      runningByAccount.set(row.accountId, next);
      runningByLedgerId.set(row.id, next);
    }

    // 4. 执行过滤查询（带 include），分页
    const [items, total] = await Promise.all([
      this.prisma.financeLedger.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: [{ txDate: 'desc' }, { id: 'desc' }],
        include: {
          account: { select: { code: true, name: true } },
          subject: { select: { code: true, name: true, category: true } },
        },
      }),
      this.prisma.financeLedger.count({ where }),
    ]);

    return {
      items: items.map((item) => this.serialize(item, runningByLedgerId.get(item.id))),
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  async findOne(id: string): Promise<FinanceLedgerResponseOutput> {
    const row = await this.prisma.financeLedger.findFirst({
      where: { id, deletedAt: null },
      include: {
        account: { select: { code: true, name: true } },
        subject: { select: { code: true, name: true, category: true } },
      },
    });
    if (!row) throw new NotFoundException(`流水 ${id} 不存在`);
    return this.serialize(row);
  }

  async create(
    dto: CreateFinanceLedgerDto,
    user: CurrentUser
  ): Promise<FinanceLedgerResponseOutput> {
    const direction = dto.amount > 0 ? 'in' : 'out';
    const created = await this.prisma.financeLedger.create({
      data: {
        txDate: new Date(`${dto.txDate}T00:00:00.000Z`),
        accountId: dto.accountId,
        subjectId: dto.subjectId,
        amount: dto.amount,
        direction,
        remark: dto.remark,
        saleOrderId: dto.saleOrderId,
        payrollRecordId: dto.payrollRecordId,
        source: 'manual',
        ...auditCreate(user),
      },
      include: {
        account: { select: { code: true, name: true } },
        subject: { select: { code: true, name: true, category: true } },
      },
    });
    return this.serialize(created);
  }

  // @no-optimistic-lock: 财务流水仅 admin 单用户操作，无并发场景；审计依赖 importBatchId + creatorEmployeeId
  async update(
    id: string,
    dto: UpdateFinanceLedgerDto,
    user: CurrentUser
  ): Promise<FinanceLedgerResponseOutput> {
    await this.findOne(id);

    // CRM 回款 ↔ 财务流水绑定 v2.1 守卫：
    // 派生 ledger（paymentId IS NOT NULL）的金额/账户/日期/方向只读
    // admin 仅可改 subjectId / remark；其他字段须回 Payment 走变更审批
    const lock = await this.prisma.financeLedger.findUnique({
      where: { id },
      select: { paymentId: true, source: true },
    });
    if (lock?.paymentId) {
      for (const field of DERIVED_LEDGER_LOCKED_FIELDS) {
        if (dto[field] !== undefined) {
          throw new ForbiddenException(
            `CRM 派生流水的「${field}」字段只读，请到源回款（Payment）修改并走变更审批`
          );
        }
      }
    }

    const { version: _v, txDate, amount, direction: _ignoredDirection, ...rest } = dto;
    const data: Prisma.FinanceLedgerUpdateInput = { ...rest, ...auditUpdate(user) };
    if (txDate) data.txDate = new Date(`${txDate}T00:00:00.000Z`);
    if (typeof amount === 'number') {
      data.amount = amount;
      data.direction = amount > 0 ? 'in' : 'out';
    }
    const updated = await this.prisma.financeLedger.update({
      where: { id },
      data,
      include: {
        account: { select: { code: true, name: true } },
        subject: { select: { code: true, name: true, category: true } },
      },
    });
    return this.serialize(updated);
  }

  async remove(id: string, user: CurrentUser): Promise<void> {
    await this.findOne(id);

    // CRM 回款 ↔ 财务流水绑定 v2.1 守卫：
    // 派生 ledger 不允许从 finance 模块直接删除，删除入口必须走源 Payment（撤回审批/软删）
    // 若需"切断关联保留独立流水"，走 unlinkPayment 端点（受保护管理端点）
    const lock = await this.prisma.financeLedger.findUnique({
      where: { id },
      select: { paymentId: true },
    });
    if (lock?.paymentId) {
      throw new ForbiddenException(
        'CRM 派生流水不允许直接删除。请到源回款（Payment）撤回审批，或先调 unlinkPayment 端点解除关联。'
      );
    }

    await this.prisma.financeLedger.update({
      where: { id },
      data: { deletedAt: new Date(), ...auditUpdate(user) },
    });
  }

  /**
   * 批量改派生 ledger 科目（受保护管理端点，绑定方案 v2.1 Phase 4.5）
   * 典型使用：admin 在 finance-ledger 列表多选"待归类"派生行，批量分到正式科目。
   *
   * 校验：
   * - 所有 ledgerIds 必须存在、未软删
   * - 目标 subjectId 必须 level=2 叶子、status=active、未软删
   * - 不要求 ledger 必须是派生（也支持手工 ledger 批量改科目，admin 视角统一入口）
   *
   * 事务内执行，updaterEmployeeId 反映批量操作者。
   */
  async batchUpdateSubject(
    ledgerIds: string[],
    subjectId: string,
    user: CurrentUser
  ): Promise<{ updated: number }> {
    const subject = await this.prisma.financeSubject.findFirst({
      where: { id: subjectId, deletedAt: null, status: 'active' },
      select: { id: true, level: true, code: true },
    });
    if (!subject) throw new BadRequestException(`科目 ${subjectId} 不存在或已停用`);
    if (subject.level !== 2) {
      throw new BadRequestException(
        `科目 ${subject.code} 是分组节点（level=1），无法挂账。请选择叶子科目（level=2）`
      );
    }

    const rows = await this.prisma.financeLedger.findMany({
      where: { id: { in: ledgerIds }, deletedAt: null },
      select: { id: true },
    });
    if (rows.length !== ledgerIds.length) {
      throw new BadRequestException(
        `部分流水不存在或已软删（提交 ${ledgerIds.length} 条，命中 ${rows.length} 条）`
      );
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const upd = await tx.financeLedger.updateMany({
        where: { id: { in: ledgerIds }, deletedAt: null },
        data: {
          subjectId,
          ...auditUpdate(user),
        },
      });
      return upd;
    });

    return { updated: result.count };
  }

  /**
   * 解除派生 ledger 与 Payment 的关联（受保护管理端点，绑定方案 v2.1）
   * 使用场景：admin 判断该 ledger 不应再受 Payment 自动同步影响，
   * 想保留这条流水作为独立账目（source 改 'manual'）。
   *
   * 副作用：
   * - paymentId 置 null（Prisma @unique 允许多个 null）
   * - source 改 'manual'
   * - remark 追加解绑理由
   *
   * 不影响 Payment 本身，也不软删 ledger。
   */
  async unlinkPayment(
    id: string,
    reason: string,
    user: CurrentUser
  ): Promise<FinanceLedgerResponseOutput> {
    if (!reason || reason.trim().length < 4) {
      throw new BadRequestException('解绑必须填写理由（至少 4 字）');
    }
    const existing = await this.prisma.financeLedger.findUnique({
      where: { id },
      select: { id: true, paymentId: true, remark: true, deletedAt: true },
    });
    if (!existing) throw new NotFoundException(`流水 ${id} 不存在`);
    if (existing.deletedAt) throw new BadRequestException('该流水已软删');
    if (!existing.paymentId) throw new BadRequestException('该流水未关联回款，无需解绑');

    const newRemark =
      `${existing.remark ?? ''} | [解绑 paymentId=${existing.paymentId}] ${reason}`.slice(0, 500);
    const updated = await this.prisma.financeLedger.update({
      where: { id },
      data: {
        paymentId: null,
        source: 'manual',
        remark: newRemark,
        ...auditUpdate(user),
      },
      include: {
        account: { select: { code: true, name: true } },
        subject: { select: { code: true, name: true, category: true } },
      },
    });
    return this.serialize(updated);
  }

  /**
   * 手动绑定一条独立 ledger 到某 Payment（受保护管理端点，绑定方案 v2.1）
   * 使用场景：历史数据规整新会话产出的回填脚本调本端点，把 dingtalk_import 老行关联到对应 Payment。
   *
   * 约束：
   * - 目标 ledger 必须当前 paymentId IS NULL（否则用 unlink 再绑）
   * - 目标 Payment 必须 approved + 活
   * - 同 paymentId 只能有 1 条 ledger（@unique 约束兜底）
   * - source 改为 'crm_payment_migrated'
   *
   * 不修改 ledger 的金额/账户/日期/方向（保留历史归集数据，与 1:1 自动派生路径区分）。
   */
  async linkPayment(
    id: string,
    paymentId: string,
    reason: string,
    user: CurrentUser
  ): Promise<FinanceLedgerResponseOutput> {
    if (!reason || reason.trim().length < 4) {
      throw new BadRequestException('绑定必须填写理由（至少 4 字）');
    }
    const existing = await this.prisma.financeLedger.findUnique({
      where: { id },
      select: { id: true, paymentId: true, remark: true, deletedAt: true, source: true },
    });
    if (!existing) throw new NotFoundException(`流水 ${id} 不存在`);
    if (existing.deletedAt) throw new BadRequestException('该流水已软删');
    if (existing.paymentId) {
      throw new BadRequestException(
        `该流水已关联 paymentId=${existing.paymentId}，请先调 unlinkPayment 解绑`
      );
    }

    const payment = await this.prisma.payment.findUnique({
      where: { id: paymentId },
      select: { id: true, flowStatus: true, deletedAt: true, serialNumber: true },
    });
    if (!payment) throw new BadRequestException(`Payment ${paymentId} 不存在`);
    if (payment.deletedAt) throw new BadRequestException(`Payment ${paymentId} 已软删`);
    if (payment.flowStatus !== 'approved') {
      throw new BadRequestException(`Payment ${paymentId} 未审批通过（${payment.flowStatus}）`);
    }

    // v2.1: 1:1 强约束，paymentId 不可重复
    // v2.2: 1:N 允许多条 ledger 绑同一 Payment（多产品拆账）。本端点为 v2.1 历史手工 link 路径，
    //       为保持兼容仍要求"同 paymentId 不重复 link"，故改用 findFirst（v2.2 Phase 11 link-payment-item 上线后本端点拟废弃）
    const occupied = await this.prisma.financeLedger.findFirst({
      where: { paymentId, deletedAt: null },
      select: { id: true },
    });
    if (occupied) {
      throw new BadRequestException(
        `Payment ${paymentId} 已绑定到另一条流水 ledger=${occupied.id}，无法重复绑定`
      );
    }

    const newRemark =
      `${existing.remark ?? ''} | [绑定 paymentId=${paymentId} 来源=${existing.source}] ${reason}`.slice(
        0,
        500
      );
    const updated = await this.prisma.financeLedger.update({
      where: { id },
      data: {
        paymentId,
        source: 'crm_payment_migrated',
        remark: newRemark,
        ...auditUpdate(user),
      },
      include: {
        account: { select: { code: true, name: true } },
        subject: { select: { code: true, name: true, category: true } },
      },
    });
    return this.serialize(updated);
  }

  // ============== 私有 ==============
  private serialize(
    row: Prisma.FinanceLedgerGetPayload<{
      include: {
        account: { select: { code: true; name: true } };
        subject: { select: { code: true; name: true; category: true } };
      };
    }>,
    runningBalance?: number
  ): FinanceLedgerResponseOutput {
    const base = serializeEntity<Record<string, unknown>>({ ...row });
    return {
      ...base,
      accountName: row.account?.name ?? null,
      subjectName: row.subject?.name ?? null,
      subjectCategory: row.subject?.category ?? null,
      runningBalance: runningBalance ?? null,
    } as FinanceLedgerResponseOutput;
  }
}

// ============== helpers ==============
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function computeDateRange(
  startDate: string | undefined,
  endDate: string | undefined,
  year: number | undefined,
  month: number | undefined
): { gte?: Date; lt?: Date } {
  if (year && month) {
    const gte = new Date(Date.UTC(year, month - 1, 1));
    const lt = new Date(Date.UTC(year, month, 1));
    return { gte, lt };
  }
  if (year) {
    return {
      gte: new Date(Date.UTC(year, 0, 1)),
      lt: new Date(Date.UTC(year + 1, 0, 1)),
    };
  }
  const out: { gte?: Date; lt?: Date } = {};
  if (startDate) out.gte = new Date(`${startDate}T00:00:00.000Z`);
  if (endDate) {
    // endDate 包含当天，所以 lt 设为次日
    const d = new Date(`${endDate}T00:00:00.000Z`);
    d.setUTCDate(d.getUTCDate() + 1);
    out.lt = d;
  }
  return out;
}
