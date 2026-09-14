import {
  type PayrollImportBatchResponseOutput,
  type PayrollImportCommitResponseOutput,
  type PayrollImportPreviewResponseOutput,
} from '@ky-azeroth/shared/schemas';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
// eslint-disable-next-line no-restricted-imports -- 薪资 Excel 解析需要调用独立 Python 脚本，spawn 比 exec 安全（不走 shell）
import { spawn } from 'child_process';
import * as path from 'path';

import { PrismaService } from '../../../common/prisma/prisma.service';
import { auditCreate, auditUpdate } from '../../../common/utils/audit-helper';
import {
  BoundedChildOutput,
  sanitizeChildOutput,
} from '../../../common/utils/bounded-child-output';
import { toJsonValue } from '../../../common/utils/json-type-helpers';
import { serializeEntity, toDateOnlyString } from '../../../common/utils/response-helpers';
import { type OpenedRegisteredFileAsset, UploadService } from '../../upload/upload.service';
import { lockPayrollPeriod, normalizePayrollPeriodKey } from '../payroll-period-lock.helper';

type ImportIssue = {
  sheetName?: string | null;
  rowIndex?: number | null;
  level: 'warning' | 'error';
  message: string;
};

type ParsedRecord = {
  employeeId: string | null;
  departmentId: string | null;
  employeeNameSnapshot: string;
  departmentNameSnapshot: string | null;
  positionSnapshot: string | null;
  entryDateSnapshot: string | null;
  bankNameSnapshot: string | null;
  bankCardNoSnapshot: string | null;
  remarkSnapshot: string | null;
  actualAttendanceDays: number | null;
  absenceDays: number | null;
  grossBaseSalary: number | null;
  grossPerformance: number | null;
  grossCommission: number | null;
  grossOther: number | null;
  grossBonusYearEnd: number | null;
  grossTotal: number | null;
  absenceDeductionAmount: number | null;
  lateDeductionAmount: number | null;
  adminDeductionAmount: number | null;
  socialSecurityPersonalAmount: number | null;
  housingFundPersonalAmount: number | null;
  deductionOtherTotal: number | null;
  deductionTotal: number | null;
  socialSecurityCompanyAmount: number | null;
  housingFundCompanyAmount: number | null;
  companyBurdenTotal: number | null;
  netSalary: number | null;
  totalLaborCost: number | null;
  sourceSheetName: string | null;
  sourceRowIndex: number | null;
  sourceRawJson: Prisma.InputJsonValue | null;
};

type ParsedPeriod = {
  periodKey: string;
  year: number;
  month: number;
  sheetName: string | null;
  companyName: string | null;
  expectedWorkDays: number | null;
  statementDate: string | null;
  rowCount: number;
  records: ParsedRecord[];
  warnings: ImportIssue[];
};

type ParsedWorkbook = {
  sourceFileName: string;
  totalSheets: number;
  parsedSheets: number;
  totalRows: number;
  periods: ParsedPeriod[];
  warnings: ImportIssue[];
  errors: ImportIssue[];
};

@Injectable()
export class PayrollImportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly uploadService: UploadService
  ) {}

  async previewImport(fileAssetId: string): Promise<PayrollImportPreviewResponseOutput> {
    const workbook = await this.parseWorkbook(fileAssetId);
    const response = {
      sourceFileName: workbook.sourceFileName,
      totalSheets: workbook.totalSheets,
      parsedSheets: workbook.parsedSheets,
      totalRows: workbook.totalRows,
      periods: workbook.periods.map((period) => ({
        id: `preview:${period.periodKey}`,
        periodKey: period.periodKey,
        year: period.year,
        month: period.month,
        sheetName: period.sheetName,
        companyName: period.companyName,
        expectedWorkDays: period.expectedWorkDays ?? null,
        statementDate: period.statementDate,
        sourceFileName: workbook.sourceFileName,
        importBatchId: null,
        status: 'preview',
        rowCount: period.rowCount,
        remark: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        sampleRecords: period.records.slice(0, 5).map((record) => ({
          employeeNameSnapshot: record.employeeNameSnapshot,
          departmentNameSnapshot: record.departmentNameSnapshot,
          positionSnapshot: record.positionSnapshot,
          netSalary: record.netSalary,
          totalLaborCost: record.totalLaborCost,
        })),
        warnings: period.warnings,
      })),
      warnings: workbook.warnings,
      errors: workbook.errors,
    } satisfies PayrollImportPreviewResponseOutput;
    return response;
  }

  async commitImport(
    fileAssetId: string,
    strategy = 'replace_period',
    currentUser: { id: string; employeeId?: string | null }
  ): Promise<PayrollImportCommitResponseOutput> {
    if (strategy !== 'replace_period') {
      throw new BadRequestException('当前仅支持 replace_period 导入策略');
    }

    const workbook = await this.parseWorkbook(fileAssetId);
    if (workbook.errors.length > 0) {
      const details = workbook.errors
        .slice(0, 5)
        .map((issue) => issue.message)
        .join('；');
      throw new BadRequestException(`导入预校验失败：${details}`);
    }

    const normalizedPeriods = workbook.periods.map((period) => ({
      period,
      periodKey: normalizePayrollPeriodKey(period),
    }));
    const periodLockKeys = [...new Set(normalizedPeriods.map(({ periodKey }) => periodKey))].sort();

    const batch = await this.prisma.$transaction(async (tx) => {
      // 事务级锁会一直持有到 commit/rollback；排序后一次性获取可避免多期间混批反向加锁死锁。
      for (const periodKey of periodLockKeys) {
        await lockPayrollPeriod(tx, periodKey);
      }

      const importBatch = await tx.payrollImportBatch.create({
        data: {
          sourceFileName: workbook.sourceFileName,
          totalSheets: workbook.totalSheets,
          parsedSheets: workbook.parsedSheets,
          totalRows: workbook.totalRows,
          successRows: workbook.totalRows,
          failedRows: workbook.errors.length,
          skippedRows: 0,
          strategy,
          status: 'completed',
          previewJson: toJsonValue(workbook),
          summaryJson: toJsonValue({
            warnings: workbook.warnings,
            errors: workbook.errors,
          }),
          errorReportJson: toJsonValue(workbook.errors),
          ...auditCreate(currentUser),
        },
      });

      const replacedPeriods: string[] = [];
      let createdRecords = 0;

      for (const { period, periodKey } of normalizedPeriods) {
        const existing = await tx.payrollPeriod.findUnique({
          where: { periodKey },
        });
        const periodData = {
          year: period.year,
          month: period.month,
          sheetName: period.sheetName,
          companyName: period.companyName,
          expectedWorkDays:
            period.expectedWorkDays === null || period.expectedWorkDays === undefined
              ? null
              : String(period.expectedWorkDays),
          statementDate: period.statementDate ? new Date(period.statementDate) : null,
          sourceFileName: workbook.sourceFileName,
          importBatchId: importBatch.id,
          status: 'imported',
          rowCount: period.rowCount,
          remark: null,
          deletedAt: null,
        };

        let persistedPeriod: { id: string };
        try {
          if (existing) {
            const now = new Date();
            await tx.payrollRecord.updateMany({
              where: { payrollPeriodId: existing.id, deletedAt: null },
              data: {
                deletedAt: now,
                version: { increment: 1 },
                ...auditUpdate(currentUser),
              },
            });
            persistedPeriod = await tx.payrollPeriod.update({
              where: { id: existing.id, version: existing.version },
              data: {
                ...periodData,
                version: { increment: 1 },
                ...auditUpdate(currentUser),
              },
              select: { id: true },
            });
            replacedPeriods.push(periodKey);
          } else {
            persistedPeriod = await tx.payrollPeriod.create({
              data: {
                periodKey,
                ...periodData,
                ...auditCreate(currentUser),
              },
              select: { id: true },
            });
          }
        } catch (error) {
          if (
            error instanceof Prisma.PrismaClientKnownRequestError &&
            (error.code === 'P2002' || error.code === 'P2025')
          ) {
            throw new ConflictException(`薪资期间 ${periodKey} 已被其他导入修改，请重试`);
          }
          throw error;
        }

        if (period.records.length > 0) {
          await tx.payrollRecord.createMany({
            data: period.records.map((record) => ({
              payrollPeriodId: persistedPeriod.id,
              employeeId: record.employeeId,
              departmentId: record.departmentId,
              employeeNameSnapshot: record.employeeNameSnapshot,
              departmentNameSnapshot: record.departmentNameSnapshot,
              positionSnapshot: record.positionSnapshot,
              entryDateSnapshot: record.entryDateSnapshot
                ? new Date(record.entryDateSnapshot)
                : null,
              bankNameSnapshot: record.bankNameSnapshot,
              bankCardNoSnapshot: record.bankCardNoSnapshot,
              remarkSnapshot: record.remarkSnapshot,
              actualAttendanceDays:
                record.actualAttendanceDays === null ? null : String(record.actualAttendanceDays),
              absenceDays: record.absenceDays === null ? null : String(record.absenceDays),
              grossBaseSalary:
                record.grossBaseSalary === null ? null : String(record.grossBaseSalary),
              grossPerformance:
                record.grossPerformance === null ? null : String(record.grossPerformance),
              grossCommission:
                record.grossCommission === null ? null : String(record.grossCommission),
              grossOther: record.grossOther === null ? null : String(record.grossOther),
              grossBonusYearEnd:
                record.grossBonusYearEnd === null ? null : String(record.grossBonusYearEnd),
              grossTotal: record.grossTotal === null ? null : String(record.grossTotal),
              absenceDeductionAmount:
                record.absenceDeductionAmount === null
                  ? null
                  : String(record.absenceDeductionAmount),
              lateDeductionAmount:
                record.lateDeductionAmount === null ? null : String(record.lateDeductionAmount),
              adminDeductionAmount:
                record.adminDeductionAmount === null ? null : String(record.adminDeductionAmount),
              socialSecurityPersonalAmount:
                record.socialSecurityPersonalAmount === null
                  ? null
                  : String(record.socialSecurityPersonalAmount),
              housingFundPersonalAmount:
                record.housingFundPersonalAmount === null
                  ? null
                  : String(record.housingFundPersonalAmount),
              deductionOtherTotal:
                record.deductionOtherTotal === null ? null : String(record.deductionOtherTotal),
              deductionTotal: record.deductionTotal === null ? null : String(record.deductionTotal),
              socialSecurityCompanyAmount:
                record.socialSecurityCompanyAmount === null
                  ? null
                  : String(record.socialSecurityCompanyAmount),
              housingFundCompanyAmount:
                record.housingFundCompanyAmount === null
                  ? null
                  : String(record.housingFundCompanyAmount),
              companyBurdenTotal:
                record.companyBurdenTotal === null ? null : String(record.companyBurdenTotal),
              netSalary: record.netSalary === null ? null : String(record.netSalary),
              totalLaborCost: record.totalLaborCost === null ? null : String(record.totalLaborCost),
              sourceSheetName: record.sourceSheetName,
              sourceRowIndex: record.sourceRowIndex,
              sourceRawJson: record.sourceRawJson ?? undefined,
              importBatchId: importBatch.id,
              ...auditCreate(currentUser),
            })),
          });
          createdRecords += period.records.length;
        }
      }

      const finalBatch = await tx.payrollImportBatch.update({
        where: { id: importBatch.id },
        data: {
          summaryJson: toJsonValue({
            replacedPeriods,
            createdRecords,
            warnings: workbook.warnings,
            errors: workbook.errors,
          }),
          ...auditUpdate(currentUser),
        },
        include: {
          periods: { where: { deletedAt: null }, orderBy: [{ year: 'desc' }, { month: 'desc' }] },
        },
      });

      return {
        batch: serializeEntity<PayrollImportBatchResponseOutput>(finalBatch),
        replacedPeriods,
        createdRecords,
      } satisfies PayrollImportCommitResponseOutput;
    });

    return batch;
  }

  async listImportBatches() {
    const items = await this.prisma.payrollImportBatch.findMany({
      where: { deletedAt: null },
      include: {
        periods: { where: { deletedAt: null }, orderBy: [{ year: 'desc' }, { month: 'desc' }] },
      },
      orderBy: { createdAt: 'desc' },
    });

    return {
      items: items.map((item) => serializeEntity<Record<string, unknown>>(item)),
    };
  }

  async getImportBatch(id: string) {
    const batch = await this.prisma.payrollImportBatch.findFirst({
      where: { id, deletedAt: null },
      include: {
        periods: { where: { deletedAt: null }, orderBy: [{ year: 'desc' }, { month: 'desc' }] },
      },
    });

    if (!batch) {
      throw new NotFoundException(`导入批次 ${id} 不存在`);
    }

    return serializeEntity<Record<string, unknown>>(batch);
  }

  private async parseWorkbook(fileAssetId: string): Promise<ParsedWorkbook> {
    if (!fileAssetId) throw new BadRequestException('缺少文件资产 ID');
    const asset = await this.uploadService.openRegisteredFileAsset(fileAssetId);
    let parsed: ParsedWorkbook;
    try {
      await this.validatePayrollWorkbookAsset(asset);
      parsed = await this.runPythonParser(asset);
    } finally {
      await asset.handle.close().catch(() => undefined);
    }

    const employees = await this.prisma.employee.findMany({
      where: { deletedAt: null },
      include: { departments: { include: { department: true }, where: { isPrimary: true } } },
    });
    const departments = await this.prisma.department.findMany({ where: { deletedAt: null } });

    const departmentMap = new Map<string, Array<{ id: string; name: string }>>();
    for (const department of departments) {
      const normalizedName = this.normalizeIdentityText(department.name);
      if (!normalizedName) continue;
      const candidates = departmentMap.get(normalizedName) ?? [];
      candidates.push(department);
      departmentMap.set(normalizedName, candidates);
    }

    for (const period of parsed.periods) {
      period.records = period.records.map((record) => {
        const normalizedRecord = this.normalizeDerivedAmounts(record, period);
        const employee = this.matchEmployee(normalizedRecord, employees);
        const department = this.matchDepartment(
          normalizedRecord.departmentNameSnapshot,
          departmentMap
        );
        if (!employee) {
          period.warnings.push({
            sheetName: period.sheetName,
            rowIndex: normalizedRecord.sourceRowIndex,
            level: 'warning',
            message: `未匹配到员工：${normalizedRecord.employeeNameSnapshot}`,
          });
        }
        return {
          ...normalizedRecord,
          employeeId: employee?.id ?? null,
          departmentId: department?.id ?? null,
        };
      });
    }

    this.validateWorkbookContract(parsed);
    return parsed;
  }

  private validateWorkbookContract(workbook: ParsedWorkbook): void {
    const normalizedPeriodSources = new Map<string, string | null>();
    let validPeriods = 0;
    let finalRecordCount = 0;

    for (const period of workbook.periods) {
      finalRecordCount += period.records.length;

      let periodKey: string;
      try {
        periodKey = normalizePayrollPeriodKey(period);
        period.periodKey = periodKey;
        validPeriods += 1;
      } catch (error) {
        workbook.errors.push({
          sheetName: period.sheetName,
          rowIndex: null,
          level: 'error',
          message: `薪资期间无效：${error instanceof Error ? error.message : String(error)}`,
        });
        continue;
      }

      if (normalizedPeriodSources.has(periodKey)) {
        const firstSheet = normalizedPeriodSources.get(periodKey) ?? '未命名 sheet';
        workbook.errors.push({
          sheetName: period.sheetName,
          rowIndex: null,
          level: 'error',
          message: `期间 ${periodKey} 重复：sheet「${firstSheet}」与「${period.sheetName ?? '未命名 sheet'}」归一为同一期间`,
        });
      } else {
        normalizedPeriodSources.set(periodKey, period.sheetName);
      }

      if (period.records.length === 0) {
        workbook.errors.push({
          sheetName: period.sheetName,
          rowIndex: null,
          level: 'error',
          message: `期间 ${periodKey} 没有有效薪资记录，replace_period 不允许隐式清空期间`,
        });
      }
      if (period.rowCount !== period.records.length) {
        workbook.errors.push({
          sheetName: period.sheetName,
          rowIndex: null,
          level: 'error',
          message: `期间 ${periodKey} 行数不一致：rowCount=${period.rowCount}，records=${period.records.length}`,
        });
      }

      this.validatePeriodEmployeeUniqueness(period, workbook.errors);
    }

    if (validPeriods === 0) {
      workbook.errors.push({
        rowIndex: null,
        level: 'error',
        message: '工作簿没有可导入的有效薪资期间',
      });
    }
    if (workbook.totalRows !== finalRecordCount) {
      workbook.errors.push({
        rowIndex: null,
        level: 'error',
        message: `工作簿总行数不一致：totalRows=${workbook.totalRows}，最终 records=${finalRecordCount}`,
      });
    }
  }

  private validatePeriodEmployeeUniqueness(period: ParsedPeriod, errors: ImportIssue[]): void {
    const matchedEmployees = new Map<string, ParsedRecord>();
    const matchedByNormalizedName = new Map<string, ParsedRecord[]>();
    const unmatchedByName = new Map<string, ParsedRecord[]>();

    for (const record of period.records) {
      const normalizedName = this.normalizeIdentityText(record.employeeNameSnapshot);
      if (!normalizedName) {
        errors.push({
          sheetName: period.sheetName,
          rowIndex: record.sourceRowIndex,
          level: 'error',
          message: `期间 ${period.periodKey} 存在姓名为空的薪资记录`,
        });
        continue;
      }

      if (record.employeeId) {
        const first = matchedEmployees.get(record.employeeId);
        if (first) {
          errors.push(
            this.buildDuplicateEmployeeIssue(period, record, first, `员工 ID ${record.employeeId}`)
          );
        } else {
          matchedEmployees.set(record.employeeId, record);
        }
        const sameNameMatches = matchedByNormalizedName.get(normalizedName) ?? [];
        sameNameMatches.push(record);
        matchedByNormalizedName.set(normalizedName, sameNameMatches);
        continue;
      }

      const candidates = unmatchedByName.get(normalizedName) ?? [];
      candidates.push(record);
      unmatchedByName.set(normalizedName, candidates);
    }

    for (const [normalizedName, records] of unmatchedByName) {
      for (let index = 1; index < records.length; index++) {
        const duplicate = records[index]!;
        const first = records
          .slice(0, index)
          .find((candidate) => !this.arePayrollIdentitiesDistinct(candidate, duplicate));
        if (first) {
          errors.push(
            this.buildDuplicateEmployeeIssue(
              period,
              duplicate,
              first,
              `规范化姓名「${normalizedName}」（部门/入职日期不足以消歧）`
            )
          );
        }
      }

      // 已匹配 ID 与未匹配规范化姓名不能分治后各自放行：跨 Map 也按部门/入职日消歧。
      const matchedRecords = matchedByNormalizedName.get(normalizedName) ?? [];
      for (const unmatched of records) {
        const conflictingMatched = matchedRecords.find(
          (matched) => !this.arePayrollIdentitiesDistinct(matched, unmatched)
        );
        if (conflictingMatched) {
          errors.push(
            this.buildDuplicateEmployeeIssue(
              period,
              unmatched,
              conflictingMatched,
              `规范化姓名「${normalizedName}」（已匹配/未匹配交叉重复）`
            )
          );
        }
      }
    }
  }

  private arePayrollIdentitiesDistinct(left: ParsedRecord, right: ParsedRecord): boolean {
    const leftDepartment = this.normalizeIdentityText(left.departmentNameSnapshot ?? '');
    const rightDepartment = this.normalizeIdentityText(right.departmentNameSnapshot ?? '');
    if (leftDepartment && rightDepartment && leftDepartment !== rightDepartment) return true;

    const leftEntryDate = left.entryDateSnapshot?.trim() ?? '';
    const rightEntryDate = right.entryDateSnapshot?.trim() ?? '';
    return Boolean(leftEntryDate && rightEntryDate && leftEntryDate !== rightEntryDate);
  }

  private buildDuplicateEmployeeIssue(
    period: ParsedPeriod,
    duplicate: ParsedRecord,
    first: ParsedRecord,
    identity: string
  ): ImportIssue {
    return {
      sheetName: period.sheetName,
      rowIndex: duplicate.sourceRowIndex,
      level: 'error',
      message: `期间 ${period.periodKey} 员工重复（${identity}）：第 ${String(
        first.sourceRowIndex ?? '?'
      )} 行与第 ${String(duplicate.sourceRowIndex ?? '?')} 行`,
    };
  }

  private normalizeIdentityText(value: unknown): string {
    if (typeof value !== 'string') return '';
    return value.normalize('NFKC').trim().replace(/\s+/g, '').toLowerCase();
  }

  private normalizeDerivedAmounts(record: ParsedRecord, period: ParsedPeriod): ParsedRecord {
    const totalLaborCost = this.sumMoney(record.grossTotal, record.companyBurdenTotal);
    if (record.totalLaborCost !== null && Math.abs(record.totalLaborCost - totalLaborCost) > 0.01) {
      period.warnings.push({
        sheetName: period.sheetName,
        rowIndex: record.sourceRowIndex,
        level: 'warning',
        message: `人工成本已按「应发合计 + 公司负担合计」重算：Excel=${record.totalLaborCost}，系统=${totalLaborCost}`,
      });
    }
    return { ...record, totalLaborCost };
  }

  private sumMoney(...values: Array<number | null | undefined>) {
    const total = values.reduce<number>((sum, value) => sum + (value ?? 0), 0);
    return Number(total.toFixed(2));
  }

  private async validatePayrollWorkbookAsset(asset: OpenedRegisteredFileAsset): Promise<void> {
    const expectedMime = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    if (
      path.extname(asset.originalName).toLowerCase() !== '.xlsx' ||
      path.extname(asset.storageKey).toLowerCase() !== '.xlsx' ||
      asset.mimeType !== expectedMime ||
      asset.size < 4 ||
      asset.size > 10 * 1024 * 1024
    ) {
      throw new BadRequestException('工资导入只接受已登记且不超过 10MB 的 .xlsx 文件');
    }
    const signature = Buffer.alloc(4);
    const { bytesRead } = await asset.handle.read(signature, 0, signature.length, 0);
    if (bytesRead !== 4 || !signature.equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]))) {
      throw new BadRequestException('工资簿内容不是有效的 XLSX 文件');
    }
  }

  private runPythonParser(asset: OpenedRegisteredFileAsset): Promise<ParsedWorkbook> {
    const scriptPath = path.join(__dirname, '../../../../scripts/parse-payroll-excel.py');
    const TIMEOUT_MS = 30_000;

    return new Promise((resolve, reject) => {
      let settled = false;
      const child = spawn('python3', [scriptPath, '/proc/self/fd/3', asset.originalName], {
        env: { PATH: process.env.PATH, HOME: process.env.HOME },
        stdio: ['ignore', 'pipe', 'pipe', asset.handle.fd],
      });
      const stdoutStream = child.stdout;
      const stderrStream = child.stderr;
      if (!stdoutStream || !stderrStream) {
        child.kill('SIGKILL');
        reject(new InternalServerErrorException('薪资解析进程输出管道不可用'));
        return;
      }

      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          child.kill('SIGKILL');
          reject(new InternalServerErrorException('薪资解析超时（30s）'));
        }
      }, TIMEOUT_MS);

      const stdoutCollector = new BoundedChildOutput(16 * 1024 * 1024);
      const stderrCollector = new BoundedChildOutput(64 * 1024);
      const rejectOutputLimit = (streamName: 'stdout' | 'stderr') => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        child.kill('SIGKILL');
        reject(new InternalServerErrorException(`薪资解析 ${streamName} 超过安全上限`));
      };

      stdoutStream.on('data', (chunk) => {
        if (!stdoutCollector.append(chunk as Buffer)) rejectOutputLimit('stdout');
      });
      stderrStream.on('data', (chunk) => {
        if (!stderrCollector.append(chunk as Buffer)) rejectOutputLimit('stderr');
      });

      child.on('error', (error) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          reject(error);
        }
      });
      child.on('close', (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        const stdout = stdoutCollector.text();
        const stderr = stderrCollector.text();
        if (code !== 0) {
          reject(
            new InternalServerErrorException(
              `薪资解析失败: ${sanitizeChildOutput(stderr || stdout) || 'no output'}`
            )
          );
          return;
        }
        try {
          resolve(JSON.parse(stdout) as ParsedWorkbook);
        } catch (error) {
          reject(
            new InternalServerErrorException(
              `薪资解析输出无效: ${sanitizeChildOutput(String(error))}`
            )
          );
        }
      });
    });
  }

  private matchDepartment(
    departmentName: string | null,
    departmentMap: Map<string, Array<{ id: string; name: string }>>
  ) {
    const normalizedName = this.normalizeIdentityText(departmentName);
    if (!normalizedName) return null;
    const candidates = departmentMap.get(normalizedName) ?? [];
    return candidates.length === 1 ? candidates[0] : null;
  }

  private matchEmployee(
    record: ParsedRecord,
    employees: Array<{
      id: string;
      name: string;
      entryDate: Date | null;
      departments: Array<{ department: { name: string } }>;
    }>
  ) {
    const normalizedEmployeeName = this.normalizeIdentityText(record.employeeNameSnapshot);
    if (!normalizedEmployeeName) return null;
    const candidates = employees.filter(
      (employee) => this.normalizeIdentityText(employee.name) === normalizedEmployeeName
    );
    if (candidates.length === 0) return null;

    let narrowedCandidates = candidates;
    if (record.entryDateSnapshot) {
      const byEntryDate = candidates.filter(
        (employee) => toDateOnlyString(employee.entryDate) === record.entryDateSnapshot
      );
      if (byEntryDate.length === 1) return byEntryDate[0];
      if (byEntryDate.length > 0) narrowedCandidates = byEntryDate;
    }

    const normalizedDepartmentName = this.normalizeIdentityText(record.departmentNameSnapshot);
    if (normalizedDepartmentName) {
      const byDepartment = narrowedCandidates.filter((employee) =>
        employee.departments.some(
          ({ department }) =>
            this.normalizeIdentityText(department.name) === normalizedDepartmentName
        )
      );
      if (byDepartment.length === 1) return byDepartment[0];
      if (byDepartment.length > 0) narrowedCandidates = byDepartment;
    }

    return narrowedCandidates.length === 1 ? narrowedCandidates[0] : null;
  }
}
