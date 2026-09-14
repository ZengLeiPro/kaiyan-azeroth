import type { FinanceLedgerResponseOutput, FinancePnlResponse } from '@ky-azeroth/shared/schemas';
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import type { PaginatedResponse } from '../../../common/interfaces/pagination.interface';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { serializeEntity, toDecimalNumber } from '../../../common/utils/response-helpers';
import { QueryFinancePnlDrilldownDto, QueryFinancePnlDto } from './dto/query-pnl.dto';

interface PnlRawRow {
  subject_id: string;
  subject_code: string;
  subject_name: string;
  category: string;
  level: number;
  parent_code: string | null;
  display_order: number;
  month: number;
  total: string; // Decimal toString
}

interface PnlSubjectMeta {
  id: string;
  code: string;
  name: string;
  category: string;
  level: number;
  parentId: string | null;
  parent: { code: string } | null;
  displayOrder: number;
}

type PnlMonths = Record<number, number> & {
  1: number;
  2: number;
  3: number;
  4: number;
  5: number;
  6: number;
  7: number;
  8: number;
  9: number;
  10: number;
  11: number;
  12: number;
};

interface PnlAggregateRow {
  subjectId: string;
  subjectCode: string;
  subjectName: string;
  category: string;
  level: number;
  parentCode: string | null;
  displayOrder: number;
  months: PnlMonths;
  total: number;
}

/**
 * 损益表（P&L）服务
 *
 * 按年聚合 ledger，输出科目 × 月份矩阵。
 * 实时 raw SQL `GROUP BY subject_id, EXTRACT(MONTH FROM tx_date)`，不落表。
 */
@Injectable()
export class FinancePnlService {
  constructor(private readonly prisma: PrismaService) {}

  async getPnl(query: QueryFinancePnlDto): Promise<FinancePnlResponse> {
    const { year } = query;
    const yearStart = new Date(Date.UTC(year, 0, 1));
    const nextYearStart = new Date(Date.UTC(year + 1, 0, 1));

    // @prisma-raw-sql: Prisma groupBy 不支持 EXTRACT(MONTH FROM date) 表达式，
    // 也无法在 groupBy 同时 select 多个关联字段（subject.code/name/category/level）。
    // 用 raw SQL 一次性聚合 + JOIN 出科目元数据，比应用层 N+1 高效得多。
    const rows = await this.prisma.$queryRaw<PnlRawRow[]>`
      SELECT
        s.id AS subject_id,
        s.code AS subject_code,
        s.name AS subject_name,
        s.category,
        s.level,
        p.code AS parent_code,
        s."displayOrder" AS display_order,
        EXTRACT(MONTH FROM l."txDate")::int AS month,
        SUM(l.amount)::text AS total
      FROM finance_ledgers l
      JOIN finance_subjects s ON s.id = l."subjectId"
      LEFT JOIN finance_subjects p ON s."parentId" = p.id
      WHERE l."deletedAt" IS NULL
        AND l."txDate" >= ${yearStart}
        AND l."txDate" < ${nextYearStart}
      GROUP BY s.id, s.code, s.name, s.category, s.level, p.code, s."displayOrder",
        EXTRACT(MONTH FROM l."txDate")
      ORDER BY s."displayOrder" ASC, month ASC
    `;

    const subjectMetas = await this.prisma.financeSubject.findMany({
      where: { deletedAt: null },
      select: {
        id: true,
        code: true,
        name: true,
        category: true,
        level: true,
        parentId: true,
        displayOrder: true,
        parent: { select: { code: true } },
      },
      orderBy: { displayOrder: 'asc' },
    });

    const subjectById = new Map(subjectMetas.map((s) => [s.id, s]));
    const displayRowMap = new Map<string, PnlAggregateRow>();

    // categoryTotals 必须只按原始流水口径累加。displayRowMap 里包含父级汇总行，
    // 不能再拿它计算 categoryTotals，否则会把分组和叶子重复加总。
    const categoryTotals: Record<string, number> = {};

    for (const r of rows) {
      const amt = Number(r.total);
      const directSubject = subjectById.get(r.subject_id) ?? subjectMetaFromRawRow(r);
      categoryTotals[directSubject.category] = round2(
        (categoryTotals[directSubject.category] ?? 0) + amt
      );

      let current: PnlSubjectMeta | null | undefined = directSubject;
      while (current) {
        addAmount(getOrCreatePnlRow(displayRowMap, current), r.month, amt);
        current = current.parentId ? subjectById.get(current.parentId) : null;
      }
    }

    const subjects = Array.from(displayRowMap.values())
      .sort((a, b) => a.displayOrder - b.displayOrder)
      .map(normalizePnlMonths);

    const revenue = categoryTotals.revenue ?? 0;
    const cogs = categoryTotals.cogs ?? 0;
    const opex = categoryTotals.opex ?? 0;
    const tax = categoryTotals.tax ?? 0;
    const otherIncome = categoryTotals.other_income ?? 0;
    // 注意：cogs/opex/tax 是「支出」，amount 已是负数累加。所以毛利 = revenue + cogs（因为 cogs 已是负）
    // 但 P&L 习惯展示绝对值。为兼容钉钉财报的展示语义：
    // 毛利 = revenue - |cogs|；按钉钉表里的金额规则 cogs 用正值显示，这里我们存的 amount 是负值（支出）
    // 所以毛利 = revenue + cogs（数学上等价）
    const grossProfit = round2(revenue + cogs);
    const grossMargin = revenue !== 0 ? round2((grossProfit / revenue) * 100) : 0;
    const profitBeforeTax = round2(grossProfit + opex + otherIncome);
    const netProfit = round2(profitBeforeTax + tax);
    const netMargin = revenue !== 0 ? round2((netProfit / revenue) * 100) : 0;

    return {
      year,
      subjects,
      categoryTotals,
      grandTotals: {
        revenue,
        cogs,
        grossProfit,
        grossMargin,
        opex,
        profitBeforeTax,
        tax,
        otherIncome,
        netProfit,
        netMargin,
      },
    };
  }

  async drilldown(
    query: QueryFinancePnlDrilldownDto
  ): Promise<PaginatedResponse<FinanceLedgerResponseOutput>> {
    const { year, month, subjectCode, page = 1, pageSize = 100 } = query;

    // 先查 subject
    const subject = await this.prisma.financeSubject.findFirst({
      where: { code: subjectCode, deletedAt: null },
    });
    if (!subject) {
      return { items: [], total: 0, page, pageSize, totalPages: 0 };
    }

    const gte = new Date(Date.UTC(year, month - 1, 1));
    const lt = new Date(Date.UTC(year, month, 1));

    const where = {
      deletedAt: null,
      subjectId: subject.id,
      txDate: { gte, lt },
    };

    const [items, total] = await Promise.all([
      this.prisma.financeLedger.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: [{ txDate: 'asc' }, { id: 'asc' }],
        include: {
          account: { select: { code: true, name: true } },
          subject: { select: { code: true, name: true, category: true } },
        },
      }),
      this.prisma.financeLedger.count({ where }),
    ]);

    // runningBalance 在下钻视图里语义不明确，省略
    type DrilldownRow = Prisma.FinanceLedgerGetPayload<{
      include: {
        account: { select: { code: true; name: true } };
        subject: { select: { code: true; name: true; category: true } };
      };
    }>;
    return {
      items: items.map((item: DrilldownRow) => {
        const base = serializeEntity<Record<string, unknown>>({ ...item });
        return {
          ...base,
          accountName: item.account?.name ?? null,
          subjectName: item.subject?.name ?? null,
          subjectCategory: item.subject?.category ?? null,
          runningBalance: null,
        } as FinanceLedgerResponseOutput;
      }),
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function createEmptyMonths(): PnlMonths {
  return Object.fromEntries(Array.from({ length: 12 }, (_, i) => [i + 1, 0])) as PnlMonths;
}

function subjectMetaFromRawRow(row: PnlRawRow): PnlSubjectMeta {
  return {
    id: row.subject_id,
    code: row.subject_code,
    name: row.subject_name,
    category: row.category,
    level: row.level,
    parentId: null,
    parent: row.parent_code ? { code: row.parent_code } : null,
    displayOrder: row.display_order,
  };
}

function getOrCreatePnlRow(
  rowMap: Map<string, PnlAggregateRow>,
  subject: PnlSubjectMeta
): PnlAggregateRow {
  const existing = rowMap.get(subject.id);
  if (existing) return existing;

  const row: PnlAggregateRow = {
    subjectId: subject.id,
    subjectCode: subject.code,
    subjectName: subject.name,
    category: subject.category,
    level: subject.level,
    parentCode: subject.parent?.code ?? null,
    displayOrder: subject.displayOrder,
    months: createEmptyMonths(),
    total: 0,
  };
  rowMap.set(subject.id, row);
  return row;
}

function addAmount(row: PnlAggregateRow, month: number, amount: number): void {
  row.months[month] = round2((row.months[month] ?? 0) + amount);
  row.total = round2(row.total + amount);
}

function normalizePnlMonths(row: PnlAggregateRow): PnlAggregateRow {
  return {
    ...row,
    months: {
      1: row.months[1] ?? 0,
      2: row.months[2] ?? 0,
      3: row.months[3] ?? 0,
      4: row.months[4] ?? 0,
      5: row.months[5] ?? 0,
      6: row.months[6] ?? 0,
      7: row.months[7] ?? 0,
      8: row.months[8] ?? 0,
      9: row.months[9] ?? 0,
      10: row.months[10] ?? 0,
      11: row.months[11] ?? 0,
      12: row.months[12] ?? 0,
    },
  };
}

// 防止未使用 import 警告
void toDecimalNumber;
