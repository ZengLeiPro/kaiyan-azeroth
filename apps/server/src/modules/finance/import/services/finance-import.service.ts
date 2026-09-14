import type {
  FinanceBalanceDiff,
  FinanceImportBatchResponse,
  FinanceImportCommitInput,
  FinanceImportCommitResponse,
  FinanceImportPreviewInput,
  FinanceImportPreviewResponse,
  FinancePnlDiff,
  FinanceReconciliation,
  QueryFinanceImportBatchInput,
} from '@ky-azeroth/shared/schemas';
import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import type { PaginatedResponse } from '../../../../common/interfaces/pagination.interface';
import { PrismaService } from '../../../../common/prisma/prisma.service';
import { auditCreate, auditUpdate } from '../../../../common/utils/audit-helper';
import { toJsonValue } from '../../../../common/utils/json-type-helpers';
import { DingtalkWorkbookReaderService } from './dingtalk-workbook-reader.service';
import { mapFinanceImportBatchResponse } from './finance-import-batch.mapper';
import {
  makeRowHash,
  parseAmount,
  parseChineseDate,
  type ParsedLedgerRow,
  parseLedgerSheet,
  type ParseRowError,
} from './ledger-row-parser';

type CurrentUser = { id: string; employeeId?: string | null };
const DINGTALK_IMPORT_ROWS_PER_BATCH = 25;

/** preview 阶段解析+暂存后的行：补上 subjectId（私账亦同） */
interface PreviewLedgerRow extends ParsedLedgerRow {
  subjectId: string;
}

interface PreviewPayload {
  accountId: string; // company_total 虚拟主账户 id
  byYear: Record<number, { company: PreviewLedgerRow[]; personal: PreviewLedgerRow[] }>;
  openingBalances: Record<string, number>; // sheetName → 期初余额（用于对账重放）
}

type PreparedDingtalkBucket = 'c' | 'p';
type PreparedDingtalkCompactRow = [
  number,
  PreparedDingtalkBucket,
  number,
  string,
  string,
  string | null,
  number,
  number,
];

export interface PreparedDingtalkImportPayload {
  workbookId: string;
  years: number[];
  openingBalances: Record<string, number>;
  rows: PreparedDingtalkCompactRow[];
  reconciliation: {
    passed: boolean;
    balanceDiffCount: number;
    pnlDiffCount: number;
  };
}

@Injectable()
export class FinanceImportService {
  private readonly logger = new Logger(FinanceImportService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly reader: DingtalkWorkbookReaderService
  ) {}

  // ============== Preview ==============
  async previewImport(
    input: FinanceImportPreviewInput,
    user: CurrentUser
  ): Promise<FinanceImportPreviewResponse> {
    const { workbookId, years } = input;

    // 1. 列出 sheets
    const sheets = await this.reader.listSheets(workbookId);
    const sheetIdByName = new Map(sheets.map((s) => [s.name, s.sheetId]));

    // 2. 加载字典
    const totalAccount = await this.prisma.financeAccount.findFirst({
      where: { code: 'company_total', deletedAt: null },
    });
    if (!totalAccount) {
      throw new InternalServerErrorException(
        '财务字典未初始化：缺少 code=company_total 的虚拟主账户。请先跑 finance seed。'
      );
    }
    const subjects = await this.prisma.financeSubject.findMany({
      where: { deletedAt: null },
      select: { id: true, name: true, level: true, category: true },
    });
    // importer 用 name 匹配，但允许命中 level=1/2（虽然挂账逻辑上只允许 level=2，
    // 极端情况下如果钉钉表用了分组名做科目，先入库后续 UI 提醒人工调整）
    const subjectByName = new Map(subjects.map((s) => [s.name, s]));

    // 3. 解析所有年份
    const allErrors: ParseRowError[] = [];
    const balanceDiffs: FinanceBalanceDiff[] = [];
    const byYear: Record<number, { company: PreviewLedgerRow[]; personal: PreviewLedgerRow[] }> =
      {};
    const openingBalances: Record<string, number> = {};

    for (const year of years) {
      const sheetName = String(year);
      const sheetId = sheetIdByName.get(sheetName);
      if (!sheetId) {
        throw new BadRequestException(`workbook 中找不到 sheet "${sheetName}"`);
      }

      // 读 A1:E1500（最多 1500 行，钉钉 API 低批量也可能偶发 HSF 超时）
      const rawRows = await this.reader.readRangeBatched(
        workbookId,
        sheetId,
        'A:E',
        1500,
        DINGTALK_IMPORT_ROWS_PER_BATCH
      );

      // 取期初余额（sheet 第 1 行通常 A/B/D 都空，E 有数字）
      const opening =
        rawRows[0] && !rawRows[0][0] && !rawRows[0][1] && !rawRows[0][3] && rawRows[0][4]
          ? (parseAmount(rawRows[0][4]) ?? 0)
          : 0;
      openingBalances[sheetName] = opening;

      // 从第 2 行（数据行）开始 parse
      const dataRows = rawRows.slice(1);
      const { rows, errors } = parseLedgerSheet(dataRows, sheetName, year, 1);

      // 4. 分流 + 科目 match
      const company: PreviewLedgerRow[] = [];
      const personal: PreviewLedgerRow[] = [];
      for (const r of rows) {
        if (r.isPersonal) {
          // 「个人」科目本身就是叶子，直接 match 同名科目（如果存在）；否则用 'non_pl' 占位
          const subj = subjectByName.get('个人') ?? subjectByName.get('个人开销');
          // 若字典里没有「个人」科目（当前 seed 里没有），用 non_pl 默认值
          // 临时方案：私账行可以借用任何 non_pl 科目；如果连这个都没有，报错
          const fallback = subjects.find((s) => s.name === '保证金缴纳') ?? subjects[0];
          const chosen = subj ?? fallback;
          if (!chosen) {
            allErrors.push({
              sheetName: r.sheetName,
              rowIndex: r.rowIndex,
              reason: '私账行无法找到任何科目挂账（字典为空）',
              rawData: {},
            });
            continue;
          }
          personal.push({ ...r, subjectId: chosen.id });
        } else {
          const subj = subjectByName.get(r.subjectName);
          if (!subj) {
            const fallback = r.isDateInferred ? subjectByName.get('待归类') : undefined;
            if (!fallback) {
              allErrors.push({
                sheetName: r.sheetName,
                rowIndex: r.rowIndex,
                reason: `科目「${r.subjectName}」未在 FinanceSubject 字典中`,
                rawData: { B: r.subjectName },
              });
              continue;
            }
            company.push({
              ...r,
              subjectId: fallback.id,
              remark: buildUncategorizedRemark(r.subjectName, r.remark),
            });
            continue;
          }
          company.push({ ...r, subjectId: subj.id });
        }
      }
      allErrors.push(...errors);

      byYear[year] = { company, personal };

      // 5. 对账 1：账户余额勾稽（按 sheet 内时序累加，与 E 列逐行对比）
      // 重要：company + personal 合并后按原 rowIndex 排序，重放累加链
      const allRowsInSheet = [...company, ...personal].sort((a, b) => a.rowIndex - b.rowIndex);
      let expected = opening;
      const TOLERANCE = 0.01;
      for (const r of allRowsInSheet) {
        expected = round2(expected + r.amount);
        const actual = round2(r.runningBalance);
        const diff = round2(expected - actual);
        if (Math.abs(diff) > TOLERANCE) {
          balanceDiffs.push({
            sheetName: r.sheetName,
            rowIndex: r.rowIndex,
            accountCode: totalAccount.code,
            expected,
            actual,
            diff,
          });
          // 重置基准为 actual，避免后续 diff 放大
          expected = actual;
        }
      }
    }

    // 6. 对账 2：财报 sheet 勾稽（按 year/month/subject 聚合 vs 财报矩阵）
    const pnlDiffs: FinancePnlDiff[] = [];
    for (const year of years) {
      const pnlSheetName = `${year}财报`;
      const pnlSheetId = sheetIdByName.get(pnlSheetName);
      if (!pnlSheetId) {
        this.logger.warn(`找不到 ${pnlSheetName}，跳过财报对账`);
        continue;
      }
      try {
        const pnlMatrix = await this.readPnlSheet(workbookId, pnlSheetId);
        const companyRows = byYear[year]?.company ?? [];
        const actualByMonthSubject = aggregateByMonthSubject(companyRows);
        const hasCoarseLaborRows = companyRows.some((row) => row.subjectName === '人工成本');
        for (const [subjectName, monthMap] of pnlMatrix) {
          const subj = subjectByName.get(subjectName);
          if (!subj) continue; // 财报中的 summary 行（如「营业收入」「净利润」）不在 SUBJECTS 表，跳过
          if (subj.level !== 2) continue; // level=1 是分组节点，财报表公式汇总行不参与明细对账
          if (hasCoarseLaborRows && isDerivedLaborSplitSubject(subjectName)) continue;
          for (let month = 1; month <= 12; month += 1) {
            const expected = normalizePnlExpected(monthMap.get(month) ?? 0, subj.category);
            const actual = actualByMonthSubject.get(`${subj.id}|${month}`) ?? 0;
            const diff = round2(expected - actual);
            if (Math.abs(diff) > 0.01) {
              pnlDiffs.push({
                year,
                month,
                subjectCode: subjectName, // 用 name 暂代 code（前端展示用）
                subjectName,
                expected,
                actual,
                diff,
              });
            }
          }
        }
      } catch (e) {
        this.logger.warn(`财报对账失败 ${pnlSheetName}: ${String(e)}`);
      }
    }

    // 7. upsert FinanceImportBatch
    const reconciliation: FinanceReconciliation = {
      passed: balanceDiffs.length === 0 && pnlDiffs.length === 0,
      balanceDiffs,
      pnlDiffs,
    };

    const totalRows = Object.values(byYear).reduce(
      (acc, y) => acc + y.company.length + y.personal.length,
      0
    );
    const companyRowsCount = Object.values(byYear).reduce((acc, y) => acc + y.company.length, 0);
    const personalRowsCount = Object.values(byYear).reduce((acc, y) => acc + y.personal.length, 0);

    const preview: PreviewPayload = { accountId: totalAccount.id, byYear, openingBalances };

    const batch = await this.prisma.financeImportBatch.create({
      data: {
        source: 'dingtalk',
        workbookId,
        sheetNames: years.map((y) => String(y)),
        totalRows: totalRows + allErrors.length,
        successRows: 0,
        personalRows: 0,
        skippedRows: 0,
        failedRows: 0,
        status: 'preview',
        previewJson: toJsonValue(preview),
        reconciliationJson: toJsonValue(reconciliation),
        errorReportJson: toJsonValue(allErrors),
        ...auditCreate(user),
      },
    });

    return {
      batchId: batch.id,
      summary: {
        totalRows: totalRows + allErrors.length,
        companyRows: companyRowsCount,
        personalRows: personalRowsCount,
        errorRows: allErrors.length,
      },
      reconciliation,
      errors: allErrors,
    };
  }

  // ============== Commit ==============
  async commitImport(
    input: FinanceImportCommitInput,
    user: CurrentUser | null
  ): Promise<FinanceImportCommitResponse> {
    const batch = await this.prisma.financeImportBatch.findFirst({
      where: { id: input.batchId, deletedAt: null },
    });
    if (!batch) throw new NotFoundException(`导入批次 ${input.batchId} 不存在`);
    if (batch.status !== 'preview') {
      throw new BadRequestException(`批次状态 ${batch.status} 不允许 commit（必须是 preview）`);
    }
    const preview = batch.previewJson as unknown as PreviewPayload;
    if (!preview || !preview.byYear) {
      throw new InternalServerErrorException('批次 previewJson 损坏，无法 commit');
    }

    let successRows = 0;
    let personalRows = 0;
    const skippedRows = 0;

    await this.prisma.$transaction(
      async (tx) => {
        for (const [yearStr, buckets] of Object.entries(preview.byYear)) {
          const year = Number(yearStr);
          const yearStart = new Date(Date.UTC(year, 0, 1));
          const nextYearStart = new Date(Date.UTC(year + 1, 0, 1));

          // replace_year：先按年度软删（不真删，保留 deletedAt 痕迹）
          if (input.strategy === 'replace_year') {
            await tx.financeLedger.updateMany({
              where: {
                txDate: { gte: yearStart, lt: nextYearStart },
                source: 'dingtalk_import',
                deletedAt: null,
              },
              data: { deletedAt: new Date(), ...auditUpdate(user) },
            });
            await tx.financePersonalLedger.updateMany({
              where: {
                txDate: { gte: yearStart, lt: nextYearStart },
                source: 'dingtalk_import',
                deletedAt: null,
              },
              data: { deletedAt: new Date(), ...auditUpdate(user) },
            });
          }

          // 写公司账。按 dingtalkRowHash upsert，避免 replace_year 软删旧行后被 unique hash 挡住。
          for (const r of buckets.company) {
            const data = {
              txDate: new Date(`${r.txDate}T00:00:00.000Z`),
              accountId: preview.accountId,
              subjectId: r.subjectId,
              amount: r.amount,
              direction: r.amount > 0 ? 'in' : 'out',
              remark: r.remark,
              source: 'dingtalk_import',
              dingtalkSheetName: r.sheetName,
              dingtalkRowIndex: r.rowIndex,
              dingtalkRowHash: r.dingtalkRowHash,
              importBatchId: batch.id,
            };
            await tx.financeLedger.upsert({
              where: { dingtalkRowHash: r.dingtalkRowHash },
              create: {
                ...data,
                ...auditCreate(user),
              },
              update: {
                ...data,
                deletedAt: null,
                ...auditUpdate(user),
              },
            });
            successRows += 1;
          }

          // 写私账，同样按 dingtalkRowHash upsert 保持 replace_year 幂等。
          for (const r of buckets.personal) {
            const data = {
              txDate: new Date(`${r.txDate}T00:00:00.000Z`),
              accountId: preview.accountId,
              subjectId: r.subjectId,
              amount: r.amount,
              direction: r.amount > 0 ? 'in' : 'out',
              remark: r.remark,
              source: 'dingtalk_import',
              dingtalkSheetName: r.sheetName,
              dingtalkRowIndex: r.rowIndex,
              dingtalkRowHash: r.dingtalkRowHash,
              importBatchId: batch.id,
            };
            await tx.financePersonalLedger.upsert({
              where: { dingtalkRowHash: r.dingtalkRowHash },
              create: {
                ...data,
                ...auditCreate(user),
              },
              update: {
                ...data,
                deletedAt: null,
                ...auditUpdate(user),
              },
            });
            personalRows += 1;
          }
        }

        // 更新批次状态
        await tx.financeImportBatch.update({
          where: { id: batch.id },
          data: {
            status: 'committed',
            successRows,
            personalRows,
            skippedRows,
            failedRows: 0,
            ...auditUpdate(user),
          },
        });
      },
      {
        maxWait: 10_000,
        timeout: 120_000,
      }
    );

    return {
      batchId: batch.id,
      status: 'committed',
      successRows,
      personalRows,
      skippedRows,
      failedRows: 0,
    };
  }

  async commitPreparedDingtalkImport(
    input: PreparedDingtalkImportPayload,
    user: CurrentUser | null = null
  ): Promise<
    FinanceImportCommitResponse & {
      summary: FinanceImportPreviewResponse['summary'];
      reconciliation: FinanceReconciliation;
    }
  > {
    validatePreparedPayload(input);
    if (
      input.reconciliation.passed !== true ||
      input.reconciliation.balanceDiffCount !== 0 ||
      input.reconciliation.pnlDiffCount !== 0
    ) {
      throw new BadRequestException('prepared payload 未通过本地预览对账，拒绝导入');
    }

    const totalAccount = await this.prisma.financeAccount.findFirst({
      where: { code: 'company_total', deletedAt: null },
    });
    if (!totalAccount) {
      throw new InternalServerErrorException(
        '财务字典未初始化：缺少 code=company_total 的虚拟主账户。'
      );
    }

    const subjects = await this.prisma.financeSubject.findMany({
      where: { deletedAt: null },
      select: { id: true, name: true, level: true, category: true },
    });
    const subjectByName = new Map(subjects.map((s) => [s.name, s]));
    const uncategorizedSubject = subjectByName.get('待归类');
    const personalFallback =
      subjectByName.get('个人') ?? subjectByName.get('个人开销') ?? subjectByName.get('保证金缴纳');
    if (!uncategorizedSubject) {
      throw new InternalServerErrorException('财务字典未初始化：缺少「待归类」科目。');
    }
    if (!personalFallback) {
      throw new InternalServerErrorException('财务字典未初始化：缺少私账挂账 fallback 科目。');
    }

    const byYear: Record<number, { company: PreviewLedgerRow[]; personal: PreviewLedgerRow[] }> =
      {};
    const openingBalances: Record<string, number> = {};
    for (const year of input.years) {
      byYear[year] = { company: [], personal: [] };
      openingBalances[String(year)] = requireFiniteNumber(
        input.openingBalances[String(year)],
        `openingBalances.${year}`
      );
    }

    for (const [index, rawRow] of input.rows.entries()) {
      const row = normalizePreparedRow(rawRow, index, input.years);
      let subjectId: string;
      let remark = row.remark;
      const isPersonal = row.bucket === 'p';

      if (isPersonal) {
        subjectId = personalFallback.id;
      } else {
        const matchedSubject = subjectByName.get(row.subjectName);
        if (matchedSubject) {
          subjectId = matchedSubject.id;
        } else {
          subjectId = uncategorizedSubject.id;
          remark = buildUncategorizedRemark(row.subjectName, remark);
        }
      }

      const sheetName = String(row.year);
      const previewRow: PreviewLedgerRow = {
        txDate: row.txDate,
        subjectName: row.subjectName,
        remark,
        amount: row.amount,
        runningBalance: row.runningBalance,
        isPersonal,
        isDateInferred: false,
        sheetName,
        rowIndex: row.rowIndex,
        dingtalkRowHash: makeRowHash(sheetName, row.rowIndex, row.txDate, row.amount, remark),
        subjectId,
      };

      const yearBucket = byYear[row.year];
      if (!yearBucket) {
        throw new BadRequestException(`prepared row[${index}] 年份未初始化`);
      }
      if (isPersonal) {
        yearBucket.personal.push(previewRow);
      } else {
        yearBucket.company.push(previewRow);
      }
    }

    const balanceDiffs = recomputeBalanceDiffs(byYear, openingBalances, totalAccount.code);
    const reconciliation: FinanceReconciliation = {
      passed: balanceDiffs.length === 0,
      balanceDiffs,
      pnlDiffs: [],
    };
    if (!reconciliation.passed) {
      throw new BadRequestException({
        message: 'prepared payload 生产端余额复核失败，拒绝导入',
        balanceDiffs: balanceDiffs.slice(0, 10),
      });
    }

    const companyRowsCount = Object.values(byYear).reduce((acc, y) => acc + y.company.length, 0);
    const personalRowsCount = Object.values(byYear).reduce((acc, y) => acc + y.personal.length, 0);
    const summary = {
      totalRows: companyRowsCount + personalRowsCount,
      companyRows: companyRowsCount,
      personalRows: personalRowsCount,
      errorRows: 0,
    };
    const preview: PreviewPayload = {
      accountId: totalAccount.id,
      byYear,
      openingBalances,
    };

    const batch = await this.prisma.financeImportBatch.create({
      data: {
        source: 'dingtalk',
        workbookId: input.workbookId,
        sheetNames: input.years.map((y) => String(y)),
        totalRows: summary.totalRows,
        successRows: 0,
        personalRows: 0,
        skippedRows: 0,
        failedRows: 0,
        status: 'preview',
        previewJson: toJsonValue(preview),
        summaryJson: toJsonValue(summary),
        reconciliationJson: toJsonValue(reconciliation),
        errorReportJson: toJsonValue([]),
        ...auditCreate(user),
      },
    });

    const committed = await this.commitImport(
      { batchId: batch.id, strategy: 'replace_year' },
      user
    );
    return { ...committed, summary, reconciliation };
  }

  // ============== Batches list / get ==============
  async listBatches(
    query: QueryFinanceImportBatchInput
  ): Promise<PaginatedResponse<FinanceImportBatchResponse>> {
    const { page, pageSize, status, source } = query;
    const where: Prisma.FinanceImportBatchWhereInput = {
      deletedAt: null,
      ...(status ? { status } : {}),
      ...(source ? { source } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.financeImportBatch.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.financeImportBatch.count({ where }),
    ]);
    return {
      items: rows.map(mapFinanceImportBatchResponse),
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  async getBatch(id: string): Promise<FinanceImportBatchResponse> {
    const row = await this.prisma.financeImportBatch.findFirst({
      where: { id, deletedAt: null },
    });
    if (!row) throw new NotFoundException(`导入批次 ${id} 不存在`);
    return mapFinanceImportBatchResponse(row);
  }

  // ============== 私有：财报矩阵读取 ==============
  private async readPnlSheet(
    workbookId: string,
    sheetId: string
  ): Promise<Map<string, Map<number, number>>> {
    // 财报 sheet 76 行 × 14 列（A=科目 + B-M=12 月 + N=全年）
    const rows = await this.reader.readRangeBatched(
      workbookId,
      sheetId,
      'A:N',
      100,
      DINGTALK_IMPORT_ROWS_PER_BATCH
    );
    const out = new Map<string, Map<number, number>>();
    // rows[0] 是表头，跳过
    for (let i = 1; i < rows.length; i += 1) {
      const r = rows[i] ?? [];
      const name = (r[0] ?? '').trim();
      if (!name || name === '科目') continue;
      const monthMap = new Map<number, number>();
      for (let m = 1; m <= 12; m += 1) {
        const v = parseAmount(r[m] ?? '');
        if (v !== null) monthMap.set(m, round2(v));
      }
      out.set(name, monthMap);
    }
    return out;
  }
}

// ============== helpers ==============
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function aggregateByMonthSubject(rows: PreviewLedgerRow[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const r of rows) {
    const month = Number(r.txDate.slice(5, 7));
    const key = `${r.subjectId}|${month}`;
    out.set(key, round2((out.get(key) ?? 0) + r.amount));
  }
  return out;
}

function recomputeBalanceDiffs(
  byYear: Record<number, { company: PreviewLedgerRow[]; personal: PreviewLedgerRow[] }>,
  openingBalances: Record<string, number>,
  accountCode: string
): FinanceBalanceDiff[] {
  const balanceDiffs: FinanceBalanceDiff[] = [];
  for (const [yearStr, buckets] of Object.entries(byYear)) {
    const sheetName = yearStr;
    let expected = openingBalances[sheetName] ?? 0;
    const rows = [...buckets.company, ...buckets.personal].sort((a, b) => a.rowIndex - b.rowIndex);
    for (const r of rows) {
      expected = round2(expected + r.amount);
      const actual = round2(r.runningBalance);
      const diff = round2(expected - actual);
      if (Math.abs(diff) > 0.01) {
        balanceDiffs.push({
          sheetName: r.sheetName,
          rowIndex: r.rowIndex,
          accountCode,
          expected,
          actual,
          diff,
        });
        expected = actual;
      }
    }
  }
  return balanceDiffs;
}

function normalizePnlExpected(value: number, category: string): number {
  // 钉钉财报按展示语义把成本/费用/税费显示为正数；ledger 里支出金额保留为负数。
  if (category === 'cogs' || category === 'opex' || category === 'tax') {
    return round2(-value);
  }
  return value;
}

function isDerivedLaborSplitSubject(subjectName: string): boolean {
  return (
    subjectName === '技术服务人员工资' ||
    subjectName === '技术服务人员五险一金' ||
    subjectName === '技术服务人员奖金' ||
    subjectName === '销售人员工资' ||
    subjectName === '销售人员五险一金' ||
    subjectName === '销售人员提成及奖金' ||
    subjectName === '研发人员工资' ||
    subjectName === '研发人员五险一金' ||
    subjectName === '一般及行政人员工资' ||
    subjectName === '一般及行政人员五险一金' ||
    subjectName === '一般及行政人员奖金'
  );
}

function buildUncategorizedRemark(subjectName: string, remark: string | null): string {
  if (remark === subjectName || remark?.startsWith(`${subjectName}｜`)) return remark;
  return remark ? `${subjectName}｜${remark}` : subjectName;
}

function validatePreparedPayload(input: PreparedDingtalkImportPayload): void {
  if (!input || typeof input !== 'object') {
    throw new BadRequestException('prepared payload 为空');
  }
  if (!input.workbookId || typeof input.workbookId !== 'string') {
    throw new BadRequestException('prepared payload 缺少 workbookId');
  }
  if (!Array.isArray(input.years) || input.years.length === 0) {
    throw new BadRequestException('prepared payload 缺少 years');
  }
  for (const year of input.years) {
    if (!Number.isInteger(year) || year < 2000 || year > 2100) {
      throw new BadRequestException(`prepared payload 年份非法: ${String(year)}`);
    }
  }
  if (!input.openingBalances || typeof input.openingBalances !== 'object') {
    throw new BadRequestException('prepared payload 缺少 openingBalances');
  }
  if (!Array.isArray(input.rows) || input.rows.length === 0) {
    throw new BadRequestException('prepared payload 缺少 rows');
  }
  if (
    !input.reconciliation ||
    typeof input.reconciliation !== 'object' ||
    typeof input.reconciliation.passed !== 'boolean'
  ) {
    throw new BadRequestException('prepared payload 缺少 reconciliation');
  }
}

function normalizePreparedRow(
  row: PreparedDingtalkCompactRow,
  index: number,
  allowedYears: number[]
): {
  year: number;
  bucket: PreparedDingtalkBucket;
  rowIndex: number;
  txDate: string;
  subjectName: string;
  remark: string | null;
  amount: number;
  runningBalance: number;
} {
  if (!Array.isArray(row) || row.length !== 8) {
    throw new BadRequestException(`prepared row[${index}] 格式非法`);
  }
  const [year, bucket, rowIndex, txDate, subjectName, remark, amount, runningBalance] = row;
  if (!allowedYears.includes(year)) {
    throw new BadRequestException(`prepared row[${index}] 年份不在 years 内`);
  }
  if (bucket !== 'c' && bucket !== 'p') {
    throw new BadRequestException(`prepared row[${index}] bucket 非法`);
  }
  if (!Number.isInteger(rowIndex) || rowIndex < 1) {
    throw new BadRequestException(`prepared row[${index}] rowIndex 非法`);
  }
  if (typeof txDate !== 'string' || !txDate.startsWith(`${year}-`)) {
    throw new BadRequestException(`prepared row[${index}] txDate 非法`);
  }
  if (typeof subjectName !== 'string' || !subjectName.trim()) {
    throw new BadRequestException(`prepared row[${index}] subjectName 为空`);
  }
  if (remark !== null && typeof remark !== 'string') {
    throw new BadRequestException(`prepared row[${index}] remark 非法`);
  }
  return {
    year,
    bucket,
    rowIndex,
    txDate,
    subjectName: subjectName.trim(),
    remark,
    amount: requireNonZeroFiniteNumber(amount, `rows[${index}].amount`),
    runningBalance: requireFiniteNumber(runningBalance, `rows[${index}].runningBalance`),
  };
}

function requireFiniteNumber(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new BadRequestException(`prepared payload ${label} 非法`);
  }
  return value;
}

function requireNonZeroFiniteNumber(value: unknown, label: string): number {
  const result = requireFiniteNumber(value, label);
  if (result === 0) {
    throw new BadRequestException(`prepared payload ${label} 不能为 0`);
  }
  return result;
}

// helper 占位以保留 imports（避免未用 import 警告）
void parseChineseDate;
