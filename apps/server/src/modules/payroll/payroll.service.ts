import type { PayrollResponseOutput } from '@ky-azeroth/shared/schemas';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';

import type { PaginatedResponse } from '../../common/interfaces/pagination.interface';
import { PrismaService } from '../../common/prisma/prisma.service';
import { auditCreate, auditUpdate } from '../../common/utils/audit-helper';
import {
  calculatePagination,
  serializeEntity,
  toDateOnlyString,
  toDecimalNumber,
} from '../../common/utils/response-helpers';
import { CreatePayrollDto } from './dto/create-payroll.dto';
import { QueryPayrollDto } from './dto/query-payroll.dto';
import { UpdatePayrollDto } from './dto/update-payroll.dto';
import { lockPayrollPeriod, normalizePayrollPeriodKey } from './payroll-period-lock.helper';

@Injectable()
export class PayrollService {
  constructor(private readonly prisma: PrismaService) {}

  async listPeriods() {
    const items = await this.prisma.payrollPeriod.findMany({
      where: { deletedAt: null },
      orderBy: [{ year: 'desc' }, { month: 'desc' }],
    });
    return { items: items.map((item) => serializeEntity<Record<string, unknown>>(item)) };
  }

  async findAll(query: QueryPayrollDto): Promise<PaginatedResponse<PayrollResponseOutput>> {
    const { keyword, periodKey, employeeId, departmentId, position, importBatchId, hasRemark } =
      query;
    const { page = 1, pageSize = 10 } = query;
    const { skip, take } = calculatePagination(page, pageSize);

    const where: Prisma.PayrollRecordWhereInput = {
      deletedAt: null,
      payrollPeriod: { deletedAt: null },
    };

    if (keyword) {
      where.OR = [
        { employeeNameSnapshot: { contains: keyword, mode: 'insensitive' } },
        { departmentNameSnapshot: { contains: keyword, mode: 'insensitive' } },
        { bankCardNoSnapshot: { contains: keyword, mode: 'insensitive' } },
      ];
    }
    if (periodKey)
      where.payrollPeriod = {
        ...(where.payrollPeriod as Prisma.PayrollPeriodWhereInput),
        periodKey,
      };
    if (employeeId) where.employeeId = employeeId;
    if (departmentId) where.departmentId = departmentId;
    if (position) where.positionSnapshot = { contains: position, mode: 'insensitive' };
    if (importBatchId) where.importBatchId = importBatchId;
    if (hasRemark === true) where.remarkSnapshot = { not: null };
    if (hasRemark === false) where.remarkSnapshot = null;

    const [items, total] = await Promise.all([
      this.prisma.payrollRecord.findMany({
        where,
        skip,
        take,
        orderBy: [
          { payrollPeriod: { year: 'desc' } },
          { payrollPeriod: { month: 'desc' } },
          { employeeNameSnapshot: 'asc' },
        ],
        include: {
          payrollPeriod: true,
          employee: { select: { id: true, name: true, serialNumber: true } },
          department: { select: { id: true, name: true } },
        },
      }),
      this.prisma.payrollRecord.count({ where }),
    ]);

    return {
      items: items.map((item) => this.serializePayroll(item)),
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  async findOne(id: string): Promise<PayrollResponseOutput> {
    const record = await this.prisma.payrollRecord.findFirst({
      where: { id, deletedAt: null },
      include: {
        payrollPeriod: true,
        employee: { select: { id: true, name: true, serialNumber: true } },
        department: { select: { id: true, name: true } },
      },
    });
    if (!record) {
      throw new NotFoundException(`薪资记录 ${id} 不存在`);
    }
    return this.serializePayroll(record);
  }

  async create(
    dto: CreatePayrollDto,
    currentUser: { id: string; employeeId?: string | null }
  ): Promise<PayrollResponseOutput> {
    const periodKey = normalizePayrollPeriodKey(dto.periodKey);

    return this.prisma.$transaction(async (tx) => {
      await lockPayrollPeriod(tx, periodKey);
      const period = await this.ensurePeriod(tx, periodKey, currentUser);
      const created = await tx.payrollRecord.create({
        data: this.buildRecordCreateInput(dto, period.id, currentUser),
        include: {
          payrollPeriod: true,
          employee: { select: { id: true, name: true, serialNumber: true } },
          department: { select: { id: true, name: true } },
        },
      });
      await this.refreshPeriodRowCount(tx, period.id, currentUser);
      return this.serializePayroll(created);
    });
  }

  async update(
    id: string,
    dto: UpdatePayrollDto,
    currentUser: { id: string; employeeId?: string | null }
  ): Promise<PayrollResponseOutput> {
    const requestVersion = this.requirePositiveVersion(dto.version, '更新薪资记录');
    const existing = await this.findOne(id);
    const oldPeriodKey = normalizePayrollPeriodKey(existing.periodKey);
    const targetPeriodKey = normalizePayrollPeriodKey(dto.periodKey ?? oldPeriodKey);
    const periodLockKeys = [...new Set([oldPeriodKey, targetPeriodKey])].sort();

    try {
      return await this.prisma.$transaction(async (tx) => {
        for (const periodKey of periodLockKeys) {
          await lockPayrollPeriod(tx, periodKey);
        }

        const targetPeriod =
          targetPeriodKey === oldPeriodKey
            ? { id: existing.payrollPeriodId, periodKey: oldPeriodKey }
            : await this.ensurePeriod(tx, targetPeriodKey, currentUser);

        const updated = await tx.payrollRecord.update({
          where: { id, version: requestVersion, deletedAt: null },
          data: {
            ...this.buildRecordUpdateInput(dto, targetPeriod.id, currentUser, existing),
            version: { increment: 1 },
          },
          include: {
            payrollPeriod: true,
            employee: { select: { id: true, name: true, serialNumber: true } },
            department: { select: { id: true, name: true } },
          },
        });

        if (existing.payrollPeriodId !== targetPeriod.id) {
          const affectedPeriods = [
            { id: existing.payrollPeriodId, periodKey: oldPeriodKey },
            { id: targetPeriod.id, periodKey: targetPeriodKey },
          ].sort((left, right) => left.periodKey.localeCompare(right.periodKey));
          for (const period of affectedPeriods) {
            await this.refreshPeriodRowCount(tx, period.id, currentUser);
          }
        }

        return this.serializePayroll(updated);
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
        throw new ConflictException(
          `数据已被其他用户修改，当前版本 ${existing.version ?? 1}。请刷新后重试。`
        );
      }
      throw error;
    }
  }

  async remove(
    id: string,
    currentUser: { id: string; employeeId?: string | null },
    requestVersion: number
  ): Promise<void> {
    const version = this.requirePositiveVersion(requestVersion, '删除薪资记录');
    const existing = await this.findOne(id);
    const periodKey = normalizePayrollPeriodKey(existing.periodKey);

    try {
      await this.prisma.$transaction(async (tx) => {
        await lockPayrollPeriod(tx, periodKey);
        await tx.payrollRecord.update({
          where: { id, version, deletedAt: null },
          data: {
            deletedAt: new Date(),
            version: { increment: 1 },
            ...auditUpdate(currentUser),
          },
        });
        await this.refreshPeriodRowCount(tx, existing.payrollPeriodId, currentUser);
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
        throw new ConflictException(
          `数据已被其他用户修改，当前版本 ${existing.version ?? 1}。请刷新后重试。`
        );
      }
      throw error;
    }
  }

  async batchRemove(
    ids: string[],
    versions: Record<string, number>,
    currentUser: { id: string; employeeId?: string | null }
  ) {
    const idSet = new Set(ids);
    const versionIds = Object.keys(versions);
    if (
      idSet.size !== ids.length ||
      versionIds.length !== idSet.size ||
      versionIds.some((id) => !idSet.has(id))
    ) {
      throw new BadRequestException('批量删除的 ids 与 versions 必须唯一且一一对应');
    }
    for (const id of ids) {
      this.requirePositiveVersion(versions[id], `删除薪资记录 ${id}`);
    }
    if (ids.length === 0) {
      return { success: 0, failed: 0, errors: [] as Array<{ id: string; error: string }> };
    }

    // 预读只用于确定 advisory lock 集合；任何存在性/version 判定均在锁后重读完成。
    const preflightRecords = await this.findBatchRecords(this.prisma, ids);
    const periodLockKeys = [
      ...new Set(
        preflightRecords.map((record) => normalizePayrollPeriodKey(record.payrollPeriod.periodKey))
      ),
    ].sort();

    return this.prisma.$transaction(async (tx) => {
      for (const periodKey of periodLockKeys) {
        await lockPayrollPeriod(tx, periodKey);
      }

      // 锁后重读 id、version 与期间，避免预读后发生删除、更新或跨期移动。
      const records = await this.findBatchRecords(tx, ids);
      const lockedPeriodKeys = new Set(periodLockKeys);
      if (
        records.length !== ids.length ||
        records.some(
          (record) =>
            !lockedPeriodKeys.has(normalizePayrollPeriodKey(record.payrollPeriod.periodKey))
        )
      ) {
        throw new ConflictException('批量删除记录或期间已变化，请刷新后重试');
      }
      if (records.some((record) => record.version !== versions[record.id])) {
        throw new ConflictException('批量删除记录版本已变化，请刷新后重试');
      }

      // 每一行都以 (id, expectedVersion) 参与最终 CAS；count 不一致会抛错并回滚整批。
      const result = await tx.payrollRecord.updateMany({
        where: {
          deletedAt: null,
          OR: ids.map((id) => ({ id, version: versions[id] })),
        },
        data: {
          deletedAt: new Date(),
          version: { increment: 1 },
          ...auditUpdate(currentUser),
        },
      });
      if (result.count !== ids.length) {
        throw new ConflictException('批量删除记录版本已变化，请刷新后重试');
      }

      const affectedPeriods = Array.from(
        new Map(
          records.map((record) => [
            normalizePayrollPeriodKey(record.payrollPeriod.periodKey),
            { id: record.payrollPeriodId, periodKey: record.payrollPeriod.periodKey },
          ])
        ).values()
      ).sort((left, right) => left.periodKey.localeCompare(right.periodKey));
      for (const period of affectedPeriods) {
        await this.refreshPeriodRowCount(tx, period.id, currentUser);
      }

      return {
        success: ids.length,
        failed: 0,
        errors: [] as Array<{ id: string; error: string }>,
      };
    });
  }

  private findBatchRecords(
    prisma: PrismaService | Prisma.TransactionClient,
    ids: string[]
  ): Promise<
    Array<{
      id: string;
      version: number;
      payrollPeriodId: string;
      payrollPeriod: { periodKey: string };
    }>
  > {
    return prisma.payrollRecord.findMany({
      where: { id: { in: ids }, deletedAt: null },
      select: {
        id: true,
        version: true,
        payrollPeriodId: true,
        payrollPeriod: { select: { periodKey: true } },
      },
    });
  }

  private requirePositiveVersion(version: unknown, action: string): number {
    if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
      throw new BadRequestException(`${action}必须携带有效的 version`);
    }
    return version;
  }

  private async ensurePeriod(
    tx: Prisma.TransactionClient,
    periodKey: string,
    currentUser: { id: string; employeeId?: string | null }
  ) {
    const normalizedPeriodKey = normalizePayrollPeriodKey(periodKey);
    const [yearText, monthText] = normalizedPeriodKey.split('-');
    const year = Number(yearText);
    const month = Number(monthText);
    return tx.payrollPeriod.upsert({
      where: { periodKey: normalizedPeriodKey },
      update: {},
      create: {
        periodKey: normalizedPeriodKey,
        year,
        month,
        status: 'draft',
        rowCount: 0,
        ...auditCreate(currentUser),
      },
    });
  }

  private buildRecordCreateInput(
    dto: CreatePayrollDto,
    payrollPeriodId: string,
    currentUser: { id: string; employeeId?: string | null }
  ) {
    // 2026-05-25 修复：PayrollRecord 的 relation field 命名为 `creatorEmployee`/`updaterEmployee`
    // （与 audit 标量 `creatorEmployeeId`/`updaterEmployeeId` 同前缀），Prisma 不允许 relation
    // syntax 与 unchecked 标量 FK 混用。统一改为纯 unchecked 风格，与 EffortRecord 等保持一致。
    const data: Prisma.PayrollRecordUncheckedCreateInput = {
      payrollPeriodId,
      employeeId: dto.employeeId ?? null,
      departmentId: dto.departmentId ?? null,
      employeeNameSnapshot: dto.employeeNameSnapshot,
      departmentNameSnapshot: dto.departmentNameSnapshot ?? null,
      positionSnapshot: dto.positionSnapshot ?? null,
      entryDateSnapshot: dto.entryDateSnapshot ? new Date(dto.entryDateSnapshot) : null,
      bankNameSnapshot: dto.bankNameSnapshot ?? null,
      bankCardNoSnapshot: dto.bankCardNoSnapshot ?? null,
      remarkSnapshot: dto.remarkSnapshot ?? null,
      actualAttendanceDays: this.toDecimalInput(dto.actualAttendanceDays),
      absenceDays: this.toDecimalInput(dto.absenceDays),
      grossBaseSalary: this.toDecimalInput(dto.grossBaseSalary),
      grossPerformance: this.toDecimalInput(dto.grossPerformance),
      grossCommission: this.toDecimalInput(dto.grossCommission),
      grossOther: this.toDecimalInput(dto.grossOther),
      grossBonusYearEnd: this.toDecimalInput(dto.grossBonusYearEnd),
      grossTotal: this.toDecimalInput(dto.grossTotal),
      absenceDeductionAmount: this.toDecimalInput(dto.absenceDeductionAmount),
      lateDeductionAmount: this.toDecimalInput(dto.lateDeductionAmount),
      adminDeductionAmount: this.toDecimalInput(dto.adminDeductionAmount),
      socialSecurityPersonalAmount: this.toDecimalInput(dto.socialSecurityPersonalAmount),
      housingFundPersonalAmount: this.toDecimalInput(dto.housingFundPersonalAmount),
      deductionOtherTotal: this.toDecimalInput(dto.deductionOtherTotal),
      deductionTotal: this.toDecimalInput(dto.deductionTotal),
      socialSecurityCompanyAmount: this.toDecimalInput(dto.socialSecurityCompanyAmount),
      housingFundCompanyAmount: this.toDecimalInput(dto.housingFundCompanyAmount),
      companyBurdenTotal: this.toDecimalInput(dto.companyBurdenTotal),
      netSalary: this.toDecimalInput(dto.netSalary),
      totalLaborCost: this.calculateTotalLaborCostInput(dto.grossTotal, dto.companyBurdenTotal),
      ...auditCreate(currentUser),
    };

    return data;
  }

  private buildRecordUpdateInput(
    dto: UpdatePayrollDto,
    payrollPeriodId: string,
    currentUser: { id: string; employeeId?: string | null },
    existing: PayrollResponseOutput
  ) {
    // 2026-05-25 修复：与 buildRecordCreateInput 同源问题——relation syntax 与 unchecked
    // FK 不能混用，统一走 unchecked 风格。
    const data: Prisma.PayrollRecordUncheckedUpdateInput = {
      payrollPeriodId,
      ...auditUpdate(currentUser),
    };
    if (dto.employeeId !== undefined) {
      data.employeeId = dto.employeeId ?? null;
    }
    if (dto.departmentId !== undefined) {
      data.departmentId = dto.departmentId ?? null;
    }
    if (dto.employeeNameSnapshot !== undefined)
      data.employeeNameSnapshot = dto.employeeNameSnapshot;
    if (dto.departmentNameSnapshot !== undefined)
      data.departmentNameSnapshot = dto.departmentNameSnapshot;
    if (dto.positionSnapshot !== undefined) data.positionSnapshot = dto.positionSnapshot;
    if (dto.entryDateSnapshot !== undefined) {
      data.entryDateSnapshot = dto.entryDateSnapshot ? new Date(dto.entryDateSnapshot) : null;
    }
    if (dto.bankNameSnapshot !== undefined) data.bankNameSnapshot = dto.bankNameSnapshot;
    if (dto.bankCardNoSnapshot !== undefined) data.bankCardNoSnapshot = dto.bankCardNoSnapshot;
    if (dto.remarkSnapshot !== undefined) data.remarkSnapshot = dto.remarkSnapshot;
    if (dto.actualAttendanceDays !== undefined)
      data.actualAttendanceDays = this.toDecimalInput(dto.actualAttendanceDays);
    if (dto.absenceDays !== undefined) data.absenceDays = this.toDecimalInput(dto.absenceDays);
    if (dto.grossBaseSalary !== undefined)
      data.grossBaseSalary = this.toDecimalInput(dto.grossBaseSalary);
    if (dto.grossPerformance !== undefined)
      data.grossPerformance = this.toDecimalInput(dto.grossPerformance);
    if (dto.grossCommission !== undefined)
      data.grossCommission = this.toDecimalInput(dto.grossCommission);
    if (dto.grossOther !== undefined) data.grossOther = this.toDecimalInput(dto.grossOther);
    if (dto.grossBonusYearEnd !== undefined)
      data.grossBonusYearEnd = this.toDecimalInput(dto.grossBonusYearEnd);
    if (dto.grossTotal !== undefined) data.grossTotal = this.toDecimalInput(dto.grossTotal);
    if (dto.absenceDeductionAmount !== undefined)
      data.absenceDeductionAmount = this.toDecimalInput(dto.absenceDeductionAmount);
    if (dto.lateDeductionAmount !== undefined)
      data.lateDeductionAmount = this.toDecimalInput(dto.lateDeductionAmount);
    if (dto.adminDeductionAmount !== undefined)
      data.adminDeductionAmount = this.toDecimalInput(dto.adminDeductionAmount);
    if (dto.socialSecurityPersonalAmount !== undefined)
      data.socialSecurityPersonalAmount = this.toDecimalInput(dto.socialSecurityPersonalAmount);
    if (dto.housingFundPersonalAmount !== undefined)
      data.housingFundPersonalAmount = this.toDecimalInput(dto.housingFundPersonalAmount);
    if (dto.deductionOtherTotal !== undefined)
      data.deductionOtherTotal = this.toDecimalInput(dto.deductionOtherTotal);
    if (dto.deductionTotal !== undefined)
      data.deductionTotal = this.toDecimalInput(dto.deductionTotal);
    if (dto.socialSecurityCompanyAmount !== undefined)
      data.socialSecurityCompanyAmount = this.toDecimalInput(dto.socialSecurityCompanyAmount);
    if (dto.housingFundCompanyAmount !== undefined)
      data.housingFundCompanyAmount = this.toDecimalInput(dto.housingFundCompanyAmount);
    if (dto.companyBurdenTotal !== undefined)
      data.companyBurdenTotal = this.toDecimalInput(dto.companyBurdenTotal);
    if (dto.netSalary !== undefined) data.netSalary = this.toDecimalInput(dto.netSalary);
    data.totalLaborCost = this.calculateTotalLaborCostInput(
      dto.grossTotal !== undefined ? dto.grossTotal : existing.grossTotal,
      dto.companyBurdenTotal !== undefined ? dto.companyBurdenTotal : existing.companyBurdenTotal
    );
    return data;
  }

  private calculateTotalLaborCostInput(
    grossTotal: Prisma.Decimal | number | null | undefined,
    companyBurdenTotal: Prisma.Decimal | number | null | undefined
  ) {
    return new Prisma.Decimal(grossTotal ?? 0)
      .plus(new Prisma.Decimal(companyBurdenTotal ?? 0))
      .toFixed(2);
  }

  private toDecimalInput(value: number | null | undefined) {
    if (value === undefined) return undefined;
    if (value === null) return null;
    return String(value);
  }

  private async refreshPeriodRowCount(
    tx: Prisma.TransactionClient,
    periodId: string,
    currentUser: { id: string; employeeId?: string | null }
  ) {
    const rowCount = await tx.payrollRecord.count({
      where: { payrollPeriodId: periodId, deletedAt: null },
    });
    await tx.payrollPeriod.update({
      where: { id: periodId },
      data: {
        rowCount,
        version: { increment: 1 },
        ...auditUpdate(currentUser),
      },
    });
  }

  private serializePayroll(item: Record<string, unknown>) {
    const record = item as Record<string, unknown> & {
      payrollPeriod?: { periodKey?: string };
      entryDateSnapshot?: Date | string | null;
      actualAttendanceDays?: Prisma.Decimal | number | null;
      absenceDays?: Prisma.Decimal | number | null;
      grossBaseSalary?: Prisma.Decimal | number | null;
      grossPerformance?: Prisma.Decimal | number | null;
      grossCommission?: Prisma.Decimal | number | null;
      grossOther?: Prisma.Decimal | number | null;
      grossBonusYearEnd?: Prisma.Decimal | number | null;
      grossTotal?: Prisma.Decimal | number | null;
      absenceDeductionAmount?: Prisma.Decimal | number | null;
      lateDeductionAmount?: Prisma.Decimal | number | null;
      adminDeductionAmount?: Prisma.Decimal | number | null;
      socialSecurityPersonalAmount?: Prisma.Decimal | number | null;
      housingFundPersonalAmount?: Prisma.Decimal | number | null;
      deductionOtherTotal?: Prisma.Decimal | number | null;
      deductionTotal?: Prisma.Decimal | number | null;
      socialSecurityCompanyAmount?: Prisma.Decimal | number | null;
      housingFundCompanyAmount?: Prisma.Decimal | number | null;
      companyBurdenTotal?: Prisma.Decimal | number | null;
      netSalary?: Prisma.Decimal | number | null;
      totalLaborCost?: Prisma.Decimal | number | null;
    };

    return serializeEntity<PayrollResponseOutput>({
      ...record,
      periodKey: record.payrollPeriod?.periodKey,
      entryDateSnapshot: toDateOnlyString(record.entryDateSnapshot ?? null),
      actualAttendanceDays:
        record.actualAttendanceDays == null ? null : toDecimalNumber(record.actualAttendanceDays),
      absenceDays: record.absenceDays == null ? null : toDecimalNumber(record.absenceDays),
      grossBaseSalary:
        record.grossBaseSalary == null ? null : toDecimalNumber(record.grossBaseSalary),
      grossPerformance:
        record.grossPerformance == null ? null : toDecimalNumber(record.grossPerformance),
      grossCommission:
        record.grossCommission == null ? null : toDecimalNumber(record.grossCommission),
      grossOther: record.grossOther == null ? null : toDecimalNumber(record.grossOther),
      grossBonusYearEnd:
        record.grossBonusYearEnd == null ? null : toDecimalNumber(record.grossBonusYearEnd),
      grossTotal: record.grossTotal == null ? null : toDecimalNumber(record.grossTotal),
      absenceDeductionAmount:
        record.absenceDeductionAmount == null
          ? null
          : toDecimalNumber(record.absenceDeductionAmount),
      lateDeductionAmount:
        record.lateDeductionAmount == null ? null : toDecimalNumber(record.lateDeductionAmount),
      adminDeductionAmount:
        record.adminDeductionAmount == null ? null : toDecimalNumber(record.adminDeductionAmount),
      socialSecurityPersonalAmount:
        record.socialSecurityPersonalAmount == null
          ? null
          : toDecimalNumber(record.socialSecurityPersonalAmount),
      housingFundPersonalAmount:
        record.housingFundPersonalAmount == null
          ? null
          : toDecimalNumber(record.housingFundPersonalAmount),
      deductionOtherTotal:
        record.deductionOtherTotal == null ? null : toDecimalNumber(record.deductionOtherTotal),
      deductionTotal: record.deductionTotal == null ? null : toDecimalNumber(record.deductionTotal),
      socialSecurityCompanyAmount:
        record.socialSecurityCompanyAmount == null
          ? null
          : toDecimalNumber(record.socialSecurityCompanyAmount),
      housingFundCompanyAmount:
        record.housingFundCompanyAmount == null
          ? null
          : toDecimalNumber(record.housingFundCompanyAmount),
      companyBurdenTotal:
        record.companyBurdenTotal == null ? null : toDecimalNumber(record.companyBurdenTotal),
      netSalary: record.netSalary == null ? null : toDecimalNumber(record.netSalary),
      totalLaborCost: record.totalLaborCost == null ? null : toDecimalNumber(record.totalLaborCost),
    });
  }
}
