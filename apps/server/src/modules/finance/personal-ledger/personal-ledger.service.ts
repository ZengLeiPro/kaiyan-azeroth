import type { FinancePersonalLedgerResponseOutput } from '@ky-azeroth/shared/schemas';
import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import type { PaginatedResponse } from '../../../common/interfaces/pagination.interface';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { auditCreate, auditUpdate } from '../../../common/utils/audit-helper';
import { serializeEntity, toDecimalNumber } from '../../../common/utils/response-helpers';
import { CreateFinancePersonalLedgerDto } from './dto/create-personal-ledger.dto';
import { QueryFinancePersonalLedgerDto } from './dto/query-personal-ledger.dto';
import { UpdateFinancePersonalLedgerDto } from './dto/update-personal-ledger.dto';

type CurrentUser = { id: string; employeeId?: string | null };

/**
 * 私账流水 service
 *
 * 与 FinanceLedgerService 结构对齐，但操作 financePersonalLedger 表（独立物理表）
 * 且 DTO 不含 saleOrderId / payrollRecordId
 */
@Injectable()
export class FinancePersonalLedgerService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(
    query: QueryFinancePersonalLedgerDto
  ): Promise<PaginatedResponse<FinancePersonalLedgerResponseOutput>> {
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

    const { gte, lt } = computeDateRange(startDate, endDate, year, month);

    const where: Prisma.FinancePersonalLedgerWhereInput = { deletedAt: null };
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

    // 累加 runningBalance（同 ledger 模式）
    const accountsScope = (accountId?.length ?? 0 > 0) ? accountId : undefined;
    const allOrdered = await this.prisma.financePersonalLedger.findMany({
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

    const [items, total] = await Promise.all([
      this.prisma.financePersonalLedger.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: [{ txDate: 'desc' }, { id: 'desc' }],
        include: {
          account: { select: { code: true, name: true } },
          subject: { select: { code: true, name: true, category: true } },
        },
      }),
      this.prisma.financePersonalLedger.count({ where }),
    ]);

    return {
      items: items.map((item) => this.serialize(item, runningByLedgerId.get(item.id))),
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  async findOne(id: string): Promise<FinancePersonalLedgerResponseOutput> {
    const row = await this.prisma.financePersonalLedger.findFirst({
      where: { id, deletedAt: null },
      include: {
        account: { select: { code: true, name: true } },
        subject: { select: { code: true, name: true, category: true } },
      },
    });
    if (!row) throw new NotFoundException(`私账流水 ${id} 不存在`);
    return this.serialize(row);
  }

  async create(
    dto: CreateFinancePersonalLedgerDto,
    user: CurrentUser
  ): Promise<FinancePersonalLedgerResponseOutput> {
    const direction = dto.amount > 0 ? 'in' : 'out';
    const created = await this.prisma.financePersonalLedger.create({
      data: {
        txDate: new Date(`${dto.txDate}T00:00:00.000Z`),
        accountId: dto.accountId,
        subjectId: dto.subjectId,
        amount: dto.amount,
        direction,
        remark: dto.remark,
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

  // @no-optimistic-lock: 私账流水仅 admin 本人操作，无并发场景
  async update(
    id: string,
    dto: UpdateFinancePersonalLedgerDto,
    user: CurrentUser
  ): Promise<FinancePersonalLedgerResponseOutput> {
    await this.findOne(id);

    const { version: _v, txDate, amount, direction: _ignoredDirection, ...rest } = dto;
    const data: Prisma.FinancePersonalLedgerUpdateInput = { ...rest, ...auditUpdate(user) };
    if (txDate) data.txDate = new Date(`${txDate}T00:00:00.000Z`);
    if (typeof amount === 'number') {
      data.amount = amount;
      data.direction = amount > 0 ? 'in' : 'out';
    }
    const updated = await this.prisma.financePersonalLedger.update({
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
    await this.prisma.financePersonalLedger.update({
      where: { id },
      data: { deletedAt: new Date(), ...auditUpdate(user) },
    });
  }

  private serialize(
    row: Prisma.FinancePersonalLedgerGetPayload<{
      include: {
        account: { select: { code: true; name: true } };
        subject: { select: { code: true; name: true; category: true } };
      };
    }>,
    runningBalance?: number
  ): FinancePersonalLedgerResponseOutput {
    const base = serializeEntity<Record<string, unknown>>({ ...row });
    return {
      ...base,
      accountName: row.account?.name ?? null,
      subjectName: row.subject?.name ?? null,
      subjectCategory: row.subject?.category ?? null,
      runningBalance: runningBalance ?? null,
    } as FinancePersonalLedgerResponseOutput;
  }
}

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
    return {
      gte: new Date(Date.UTC(year, month - 1, 1)),
      lt: new Date(Date.UTC(year, month, 1)),
    };
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
    const d = new Date(`${endDate}T00:00:00.000Z`);
    d.setUTCDate(d.getUTCDate() + 1);
    out.lt = d;
  }
  return out;
}
