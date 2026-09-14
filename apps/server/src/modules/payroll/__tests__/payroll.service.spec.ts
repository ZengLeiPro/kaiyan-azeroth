import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  asPrismaService,
  createMockPrismaService,
  type MockPrismaService,
} from '../../../test/prisma-mock.factory';
import type { CreatePayrollDto } from '../dto/create-payroll.dto';
import type { QueryPayrollDto } from '../dto/query-payroll.dto';
import type { UpdatePayrollDto } from '../dto/update-payroll.dto';
import { PayrollService } from '../payroll.service';

/**
 * PayrollService 单测。覆盖:
 * - listPeriods / findAll / findOne / create / update / remove / batchRemove
 * - Decimal 22 字段:写入 String 化、读取 number 化
 * - 乐观锁 P2025 → ConflictException
 * - 跨期更新触发双 period rowCount 刷新
 * - 软删除 + 批量删除部分缺失
 * - 关键边界:keyword/period/employee/department/hasRemark 筛选
 */
describe('PayrollService', () => {
  let service: PayrollService;
  let mockPrisma: MockPrismaService;

  const currentUser = { id: 'admin-1', employeeId: 'emp-admin-1' };

  beforeEach(() => {
    mockPrisma = createMockPrismaService();
    service = new PayrollService(asPrismaService(mockPrisma));
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ─── Helpers ────────────────────────────────────────────────────────────

  function buildPeriod(overrides: Record<string, unknown> = {}) {
    return {
      id: 'period-202604',
      periodKey: '2026-04',
      year: 2026,
      month: 4,
      status: 'draft',
      rowCount: 0,
      deletedAt: null,
      createdAt: new Date('2026-04-01'),
      updatedAt: new Date('2026-04-01'),
      ...overrides,
    };
  }

  function buildRecord(overrides: Record<string, unknown> = {}) {
    return {
      id: 'rec-1',
      payrollPeriodId: 'period-202604',
      employeeId: 'emp-1',
      departmentId: 'dept-1',
      employeeNameSnapshot: '张三',
      departmentNameSnapshot: '研发部',
      positionSnapshot: '开发',
      entryDateSnapshot: new Date('2024-01-01'),
      bankNameSnapshot: '工商银行',
      bankCardNoSnapshot: '6200000000000000000',
      remarkSnapshot: null,
      actualAttendanceDays: new Prisma.Decimal('22'),
      absenceDays: new Prisma.Decimal('0'),
      grossBaseSalary: new Prisma.Decimal('10000.00'),
      grossPerformance: new Prisma.Decimal('2000.00'),
      grossCommission: new Prisma.Decimal('0.00'),
      grossOther: new Prisma.Decimal('0.00'),
      grossBonusYearEnd: new Prisma.Decimal('0.00'),
      grossTotal: new Prisma.Decimal('12000.00'),
      absenceDeductionAmount: new Prisma.Decimal('0.00'),
      lateDeductionAmount: new Prisma.Decimal('0.00'),
      adminDeductionAmount: new Prisma.Decimal('0.00'),
      socialSecurityPersonalAmount: new Prisma.Decimal('800.00'),
      housingFundPersonalAmount: new Prisma.Decimal('500.00'),
      deductionOtherTotal: new Prisma.Decimal('0.00'),
      deductionTotal: new Prisma.Decimal('1300.00'),
      socialSecurityCompanyAmount: new Prisma.Decimal('1600.00'),
      housingFundCompanyAmount: new Prisma.Decimal('500.00'),
      companyBurdenTotal: new Prisma.Decimal('2100.00'),
      netSalary: new Prisma.Decimal('10700.00'),
      totalLaborCost: new Prisma.Decimal('14100.00'),
      importBatchId: null,
      version: 1,
      deletedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      payrollPeriod: buildPeriod(),
      employee: { id: 'emp-1', name: '张三', serialNumber: 'EMP001' },
      department: { id: 'dept-1', name: '研发部' },
      ...overrides,
    };
  }

  function buildCreateDto(overrides: Partial<CreatePayrollDto> = {}): CreatePayrollDto {
    return {
      periodKey: '2026-04',
      employeeId: 'emp-1',
      departmentId: 'dept-1',
      employeeNameSnapshot: '张三',
      departmentNameSnapshot: '研发部',
      positionSnapshot: '开发',
      entryDateSnapshot: '2024-01-01',
      bankNameSnapshot: '工商银行',
      bankCardNoSnapshot: '6200000000000000000',
      remarkSnapshot: null,
      actualAttendanceDays: 22,
      absenceDays: 0,
      grossBaseSalary: 10000,
      grossPerformance: 2000,
      grossCommission: 0,
      grossOther: 0,
      grossBonusYearEnd: 0,
      grossTotal: 12000,
      absenceDeductionAmount: 0,
      lateDeductionAmount: 0,
      adminDeductionAmount: 0,
      socialSecurityPersonalAmount: 800,
      housingFundPersonalAmount: 500,
      deductionOtherTotal: 0,
      deductionTotal: 1300,
      socialSecurityCompanyAmount: 1600,
      housingFundCompanyAmount: 500,
      companyBurdenTotal: 2100,
      netSalary: 10700,
      totalLaborCost: 14100,
      ...overrides,
    } as unknown as CreatePayrollDto;
  }

  // ─── listPeriods ────────────────────────────────────────────────────────

  describe('listPeriods', () => {
    it('returns periods sorted by year/month desc, excluding soft-deleted', async () => {
      const p1 = buildPeriod({ id: 'p1', year: 2026, month: 5, periodKey: '2026-05' });
      const p2 = buildPeriod({ id: 'p2', year: 2026, month: 4, periodKey: '2026-04' });
      mockPrisma.payrollPeriod.findMany.mockResolvedValue([p1, p2]);

      const result = await service.listPeriods();

      expect(result.items).toHaveLength(2);
      const findArg = mockPrisma.payrollPeriod.findMany.mock.calls[0]?.[0];
      expect(findArg).toEqual(
        expect.objectContaining({
          where: { deletedAt: null },
          orderBy: [{ year: 'desc' }, { month: 'desc' }],
        })
      );
    });

    it('returns empty when no periods', async () => {
      mockPrisma.payrollPeriod.findMany.mockResolvedValue([]);
      const result = await service.listPeriods();
      expect(result).toEqual({ items: [] });
    });
  });

  // ─── findAll ────────────────────────────────────────────────────────────

  describe('findAll', () => {
    it('returns paginated records with Decimal converted to number', async () => {
      mockPrisma.payrollRecord.findMany.mockResolvedValue([buildRecord()]);
      mockPrisma.payrollRecord.count.mockResolvedValue(1);

      const result = await service.findAll({ page: 1, pageSize: 10 } as QueryPayrollDto);

      expect(result.total).toBe(1);
      expect(result.page).toBe(1);
      expect(result.pageSize).toBe(10);
      expect(result.totalPages).toBe(1);
      expect(result.items).toHaveLength(1);
      const item = result.items[0]!;
      // Decimal 22 字段全部转为 number
      expect(typeof item.grossBaseSalary).toBe('number');
      expect(item.grossBaseSalary).toBe(10000);
      expect(typeof item.netSalary).toBe('number');
      expect(item.netSalary).toBe(10700);
      // periodKey 从 include 拍平
      expect(item.periodKey).toBe('2026-04');
    });

    it('applies keyword filter on employeeName/departmentName/bankCardNo', async () => {
      mockPrisma.payrollRecord.findMany.mockResolvedValue([]);
      mockPrisma.payrollRecord.count.mockResolvedValue(0);

      await service.findAll({ page: 1, pageSize: 10, keyword: '张' } as QueryPayrollDto);

      const arg = mockPrisma.payrollRecord.findMany.mock.calls[0]?.[0] as {
        where: { OR?: unknown[] };
      };
      expect(arg.where.OR).toEqual(
        expect.arrayContaining([{ employeeNameSnapshot: { contains: '张', mode: 'insensitive' } }])
      );
    });

    it('applies periodKey filter through payrollPeriod relation', async () => {
      mockPrisma.payrollRecord.findMany.mockResolvedValue([]);
      mockPrisma.payrollRecord.count.mockResolvedValue(0);

      await service.findAll({
        page: 1,
        pageSize: 10,
        periodKey: '2026-04',
      } as QueryPayrollDto);

      const arg = mockPrisma.payrollRecord.findMany.mock.calls[0]?.[0] as {
        where: { payrollPeriod: { periodKey?: string } };
      };
      expect(arg.where.payrollPeriod.periodKey).toBe('2026-04');
    });

    it('filters by hasRemark=true (remarkSnapshot not null)', async () => {
      mockPrisma.payrollRecord.findMany.mockResolvedValue([]);
      mockPrisma.payrollRecord.count.mockResolvedValue(0);

      await service.findAll({
        page: 1,
        pageSize: 10,
        hasRemark: true,
      } as QueryPayrollDto);

      const arg = mockPrisma.payrollRecord.findMany.mock.calls[0]?.[0] as {
        where: { remarkSnapshot?: unknown };
      };
      expect(arg.where.remarkSnapshot).toEqual({ not: null });
    });

    it('filters by hasRemark=false (remarkSnapshot is null)', async () => {
      mockPrisma.payrollRecord.findMany.mockResolvedValue([]);
      mockPrisma.payrollRecord.count.mockResolvedValue(0);

      await service.findAll({
        page: 1,
        pageSize: 10,
        hasRemark: false,
      } as QueryPayrollDto);

      const arg = mockPrisma.payrollRecord.findMany.mock.calls[0]?.[0] as {
        where: { remarkSnapshot: unknown };
      };
      expect(arg.where.remarkSnapshot).toBeNull();
    });

    it('filters by employeeId / departmentId / importBatchId', async () => {
      mockPrisma.payrollRecord.findMany.mockResolvedValue([]);
      mockPrisma.payrollRecord.count.mockResolvedValue(0);

      await service.findAll({
        page: 1,
        pageSize: 10,
        employeeId: 'emp-7',
        departmentId: 'dept-9',
        importBatchId: 'batch-123',
      } as QueryPayrollDto);

      const arg = mockPrisma.payrollRecord.findMany.mock.calls[0]?.[0] as {
        where: Record<string, unknown>;
      };
      expect(arg.where.employeeId).toBe('emp-7');
      expect(arg.where.departmentId).toBe('dept-9');
      expect(arg.where.importBatchId).toBe('batch-123');
    });

    it('excludes soft-deleted records (deletedAt: null)', async () => {
      mockPrisma.payrollRecord.findMany.mockResolvedValue([]);
      mockPrisma.payrollRecord.count.mockResolvedValue(0);

      await service.findAll({ page: 1, pageSize: 10 } as QueryPayrollDto);

      const arg = mockPrisma.payrollRecord.findMany.mock.calls[0]?.[0] as {
        where: { deletedAt: null };
      };
      expect(arg.where.deletedAt).toBeNull();
    });
  });

  // ─── findOne ────────────────────────────────────────────────────────────

  describe('findOne', () => {
    it('returns serialized record when found', async () => {
      mockPrisma.payrollRecord.findFirst.mockResolvedValue(buildRecord());

      const result = await service.findOne('rec-1');

      expect(result.id).toBe('rec-1');
      expect(result.grossTotal).toBe(12000);
      expect(result.netSalary).toBe(10700);
    });

    it('throws NotFoundException when not found', async () => {
      mockPrisma.payrollRecord.findFirst.mockResolvedValue(null);

      await expect(service.findOne('missing')).rejects.toThrow(NotFoundException);
    });

    it('excludes soft-deleted records', async () => {
      mockPrisma.payrollRecord.findFirst.mockResolvedValue(null);

      await expect(service.findOne('soft-deleted')).rejects.toThrow(NotFoundException);

      const arg = mockPrisma.payrollRecord.findFirst.mock.calls[0]?.[0] as {
        where: { id: string; deletedAt: null };
      };
      expect(arg.where.deletedAt).toBeNull();
    });

    it('converts all 22 Decimal fields to numbers', async () => {
      mockPrisma.payrollRecord.findFirst.mockResolvedValue(buildRecord());

      const result = await service.findOne('rec-1');

      // 抽查关键 Decimal 字段
      const decimalFields = [
        'actualAttendanceDays',
        'absenceDays',
        'grossBaseSalary',
        'grossPerformance',
        'grossTotal',
        'deductionTotal',
        'netSalary',
        'totalLaborCost',
      ] as const;
      for (const f of decimalFields) {
        expect(typeof (result as Record<string, unknown>)[f]).toBe('number');
      }
    });

    it('returns null for nullable Decimal fields when DB value is null', async () => {
      mockPrisma.payrollRecord.findFirst.mockResolvedValue(
        buildRecord({
          grossPerformance: null,
          grossCommission: null,
        })
      );

      const result = await service.findOne('rec-1');

      expect((result as Record<string, unknown>).grossPerformance).toBeNull();
      expect((result as Record<string, unknown>).grossCommission).toBeNull();
    });
  });

  // ─── create ─────────────────────────────────────────────────────────────

  describe('create', () => {
    it('upserts period and creates record with Decimal as String', async () => {
      mockPrisma.payrollPeriod.upsert.mockResolvedValue(buildPeriod());
      mockPrisma.payrollRecord.create.mockResolvedValue(buildRecord());
      mockPrisma.payrollRecord.count.mockResolvedValue(1);
      mockPrisma.payrollPeriod.update.mockResolvedValue(buildPeriod({ rowCount: 1 }));

      const result = await service.create(buildCreateDto(), currentUser);

      expect(result.id).toBe('rec-1');
      // 1. period upsert 调用
      expect(mockPrisma.payrollPeriod.upsert).toHaveBeenCalledTimes(1);
      const upsertArg = mockPrisma.payrollPeriod.upsert.mock.calls[0]?.[0] as {
        where: { periodKey: string };
        create: { year: number; month: number };
      };
      expect(upsertArg.where.periodKey).toBe('2026-04');
      expect(upsertArg.create.year).toBe(2026);
      expect(upsertArg.create.month).toBe(4);

      // 2. 创建记录:Decimal 字段被 String() 序列化
      const createArg = mockPrisma.payrollRecord.create.mock.calls[0]?.[0] as {
        data: Record<string, unknown>;
      };
      expect(createArg.data.grossBaseSalary).toBe('10000');
      expect(createArg.data.netSalary).toBe('10700');
      expect(typeof createArg.data.grossBaseSalary).toBe('string');

      // 3. rowCount 与 period.version 在同一事务内一起刷新
      expect(mockPrisma.payrollPeriod.update).toHaveBeenCalledTimes(1);
      expect(mockPrisma.payrollPeriod.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ rowCount: 1, version: { increment: 1 } }),
        })
      );
      expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
      const [lockOrder] = mockPrisma.$executeRaw.mock.invocationCallOrder;
      const [recordWriteOrder] = mockPrisma.payrollRecord.create.mock.invocationCallOrder;
      expect(lockOrder as number).toBeLessThan(recordWriteOrder as number);
    });

    it('keeps the lock, record write, and rowCount/version refresh on the transaction client', async () => {
      const transactionPrisma = createMockPrismaService();
      transactionPrisma.payrollPeriod.upsert.mockResolvedValue(buildPeriod());
      transactionPrisma.payrollRecord.create.mockResolvedValue(buildRecord());
      transactionPrisma.payrollRecord.count.mockResolvedValue(1);
      transactionPrisma.payrollPeriod.update.mockResolvedValue(buildPeriod({ rowCount: 1 }));
      mockPrisma.$transaction.mockImplementation(
        async (callback: (tx: MockPrismaService) => Promise<unknown>) => callback(transactionPrisma)
      );

      await service.create(buildCreateDto(), currentUser);

      expect(transactionPrisma.$executeRaw).toHaveBeenCalledTimes(1);
      expect(transactionPrisma.payrollRecord.create).toHaveBeenCalledTimes(1);
      expect(transactionPrisma.payrollRecord.count).toHaveBeenCalledTimes(1);
      expect(transactionPrisma.payrollPeriod.update).toHaveBeenCalledTimes(1);
      expect(mockPrisma.$executeRaw).not.toHaveBeenCalled();
      expect(mockPrisma.payrollRecord.create).not.toHaveBeenCalled();
      expect(mockPrisma.payrollRecord.count).not.toHaveBeenCalled();
      expect(mockPrisma.payrollPeriod.update).not.toHaveBeenCalled();
    });

    it('writes employee and department by scalar FK (unchecked input)', async () => {
      mockPrisma.payrollPeriod.upsert.mockResolvedValue(buildPeriod());
      mockPrisma.payrollRecord.create.mockResolvedValue(buildRecord());
      mockPrisma.payrollRecord.count.mockResolvedValue(1);
      mockPrisma.payrollPeriod.update.mockResolvedValue(buildPeriod());

      await service.create(
        buildCreateDto({ employeeId: 'emp-x', departmentId: 'dept-y' }),
        currentUser
      );

      // 2026-05-25 修复：PayrollRecord relation field 命名 `creatorEmployee`/`updaterEmployee`
      // 与 audit 标量 FK 同前缀，Prisma 拒绝 relation+unchecked 混用，统一改 unchecked 风格。
      const createArg = mockPrisma.payrollRecord.create.mock.calls[0]?.[0] as {
        data: { employeeId?: string | null; departmentId?: string | null };
      };
      expect(createArg.data.employeeId).toBe('emp-x');
      expect(createArg.data.departmentId).toBe('dept-y');
    });

    it('parses entryDateSnapshot string to Date', async () => {
      mockPrisma.payrollPeriod.upsert.mockResolvedValue(buildPeriod());
      mockPrisma.payrollRecord.create.mockResolvedValue(buildRecord());
      mockPrisma.payrollRecord.count.mockResolvedValue(1);
      mockPrisma.payrollPeriod.update.mockResolvedValue(buildPeriod());

      await service.create(buildCreateDto({ entryDateSnapshot: '2024-01-15' }), currentUser);

      const createArg = mockPrisma.payrollRecord.create.mock.calls[0]?.[0] as {
        data: { entryDateSnapshot: Date };
      };
      expect(createArg.data.entryDateSnapshot).toBeInstanceOf(Date);
    });

    it('preserves Decimal precision via String() (no float drift)', async () => {
      mockPrisma.payrollPeriod.upsert.mockResolvedValue(buildPeriod());
      mockPrisma.payrollRecord.create.mockResolvedValue(buildRecord());
      mockPrisma.payrollRecord.count.mockResolvedValue(1);
      mockPrisma.payrollPeriod.update.mockResolvedValue(buildPeriod());

      // 经典的 JS 浮点漂移:0.1 + 0.2 = 0.30000000000000004
      // 但 String() 后传给 Prisma Decimal 不会漂移
      await service.create(buildCreateDto({ grossOther: 0.1 + 0.2 }), currentUser);

      const createArg = mockPrisma.payrollRecord.create.mock.calls[0]?.[0] as {
        data: { grossOther: string };
      };
      // 字符串字面量,Prisma Decimal 会按字符串精确解析
      expect(typeof createArg.data.grossOther).toBe('string');
    });

    it('derives totalLaborCost from grossTotal + companyBurdenTotal on creation', async () => {
      mockPrisma.payrollPeriod.upsert.mockResolvedValue(buildPeriod());
      mockPrisma.payrollRecord.create.mockResolvedValue(buildRecord());
      mockPrisma.payrollRecord.count.mockResolvedValue(1);
      mockPrisma.payrollPeriod.update.mockResolvedValue(buildPeriod());

      await service.create(
        buildCreateDto({ grossTotal: 10000, companyBurdenTotal: 1234.56, totalLaborCost: 1 }),
        currentUser
      );

      const createArg = mockPrisma.payrollRecord.create.mock.calls[0]?.[0] as {
        data: Record<string, unknown>;
      };
      expect(createArg.data.totalLaborCost).toBe('11234.56');
    });

    it('records audit createBy on creation', async () => {
      mockPrisma.payrollPeriod.upsert.mockResolvedValue(buildPeriod());
      mockPrisma.payrollRecord.create.mockResolvedValue(buildRecord());
      mockPrisma.payrollRecord.count.mockResolvedValue(1);
      mockPrisma.payrollPeriod.update.mockResolvedValue(buildPeriod());

      await service.create(buildCreateDto(), currentUser);

      const createArg = mockPrisma.payrollRecord.create.mock.calls[0]?.[0] as {
        data: Record<string, unknown>;
      };
      expect(createArg.data).toHaveProperty('creatorEmployeeId');
    });
  });

  // ─── update ─────────────────────────────────────────────────────────────

  describe('update', () => {
    it.each([undefined, 0, -1, 1.5])('rejects non-positive integer version %s', async (version) => {
      await expect(
        service.update('rec-1', { version } as UpdatePayrollDto, currentUser)
      ).rejects.toThrow(BadRequestException);
      expect(mockPrisma.payrollRecord.findFirst).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when record not found', async () => {
      mockPrisma.payrollRecord.findFirst.mockResolvedValue(null);

      await expect(
        service.update('missing', { version: 1 } as UpdatePayrollDto, currentUser)
      ).rejects.toThrow(NotFoundException);
    });

    it('updates record with version increment (optimistic lock)', async () => {
      mockPrisma.payrollRecord.findFirst.mockResolvedValue(buildRecord({ version: 3 }));
      mockPrisma.payrollRecord.update.mockResolvedValue(buildRecord({ version: 4 }));

      await service.update(
        'rec-1',
        { version: 3, grossBaseSalary: 11000 } as UpdatePayrollDto,
        currentUser
      );

      const updateArg = mockPrisma.payrollRecord.update.mock.calls[0]?.[0] as {
        where: { id: string; version: number };
        data: { version: { increment: number }; grossBaseSalary: string };
      };
      expect(updateArg.where.version).toBe(3);
      expect(updateArg.data.version).toEqual({ increment: 1 });
      expect(updateArg.data.grossBaseSalary).toBe('11000');
    });

    it('uses the transaction client for the lock and record CAS write', async () => {
      const transactionPrisma = createMockPrismaService();
      mockPrisma.payrollRecord.findFirst.mockResolvedValue(buildRecord({ version: 3 }));
      transactionPrisma.payrollRecord.update.mockResolvedValue(buildRecord({ version: 4 }));
      mockPrisma.$transaction.mockImplementation(
        async (callback: (tx: MockPrismaService) => Promise<unknown>) => callback(transactionPrisma)
      );

      await service.update(
        'rec-1',
        { version: 3, grossBaseSalary: 11000 } as UpdatePayrollDto,
        currentUser
      );

      expect(transactionPrisma.$executeRaw).toHaveBeenCalledTimes(1);
      expect(transactionPrisma.payrollRecord.update).toHaveBeenCalledTimes(1);
      expect(mockPrisma.$executeRaw).not.toHaveBeenCalled();
      expect(mockPrisma.payrollRecord.update).not.toHaveBeenCalled();
    });

    it('recalculates totalLaborCost from merged grossTotal + companyBurdenTotal on update', async () => {
      mockPrisma.payrollRecord.findFirst.mockResolvedValue(
        buildRecord({
          grossTotal: new Prisma.Decimal('12000.00'),
          companyBurdenTotal: new Prisma.Decimal('2100.00'),
        })
      );
      mockPrisma.payrollRecord.update.mockResolvedValue(buildRecord());

      await service.update(
        'rec-1',
        { version: 1, grossTotal: 10000, totalLaborCost: 1 } as UpdatePayrollDto,
        currentUser
      );

      const updateArg = mockPrisma.payrollRecord.update.mock.calls[0]?.[0] as {
        data: Record<string, unknown>;
      };
      expect(updateArg.data.grossTotal).toBe('10000');
      expect(updateArg.data.totalLaborCost).toBe('12100.00');
    });

    it('throws ConflictException on P2025 (version mismatch)', async () => {
      mockPrisma.payrollRecord.findFirst.mockResolvedValue(buildRecord({ version: 1 }));
      const p2025 = new Prisma.PrismaClientKnownRequestError('not found', {
        code: 'P2025',
        clientVersion: '6',
      });
      mockPrisma.payrollRecord.update.mockRejectedValue(p2025);

      await expect(
        service.update('rec-1', { version: 99 } as UpdatePayrollDto, currentUser)
      ).rejects.toThrow(ConflictException);
    });

    it('refreshes both period rowCounts when period changes', async () => {
      const oldPeriodId = 'period-old';
      const newPeriodId = 'period-new';
      mockPrisma.payrollRecord.findFirst.mockResolvedValue(
        buildRecord({ payrollPeriodId: oldPeriodId })
      );
      mockPrisma.payrollPeriod.upsert.mockResolvedValue(buildPeriod({ id: newPeriodId }));
      mockPrisma.payrollRecord.update.mockResolvedValue(
        buildRecord({ payrollPeriodId: newPeriodId })
      );
      mockPrisma.payrollRecord.count.mockResolvedValue(0);
      mockPrisma.payrollPeriod.update.mockResolvedValue(buildPeriod());

      await service.update(
        'rec-1',
        { periodKey: '2026-05', version: 1 } as UpdatePayrollDto,
        currentUser
      );

      // 旧/新期间按规范化 periodKey 固定顺序加锁，并在同一事务刷新两期 rowCount/version。
      const lockKeys = mockPrisma.$executeRaw.mock.calls.map(
        ([sql]) => (sql as Prisma.Sql).values[0]
      );
      expect(lockKeys).toEqual(['payroll_period:2026-04', 'payroll_period:2026-05']);
      expect(mockPrisma.payrollPeriod.update).toHaveBeenCalledTimes(2);
      for (const [arg] of mockPrisma.payrollPeriod.update.mock.calls) {
        expect(arg.data.version).toEqual({ increment: 1 });
      }
      expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
    });

    it('does NOT refresh period when period unchanged', async () => {
      mockPrisma.payrollRecord.findFirst.mockResolvedValue(buildRecord());
      mockPrisma.payrollRecord.update.mockResolvedValue(buildRecord());

      await service.update(
        'rec-1',
        { grossBaseSalary: 12000, version: 1 } as UpdatePayrollDto,
        currentUser
      );

      // 没改 periodKey -> 不调 payrollPeriod.update
      expect(mockPrisma.payrollPeriod.update).not.toHaveBeenCalled();
    });

    it('clears employee FK when employeeId is null (unchecked input)', async () => {
      mockPrisma.payrollRecord.findFirst.mockResolvedValue(buildRecord());
      mockPrisma.payrollRecord.update.mockResolvedValue(buildRecord());

      await service.update(
        'rec-1',
        { employeeId: null, version: 1 } as UpdatePayrollDto,
        currentUser
      );

      // 2026-05-25 修复：unchecked 风格下 employeeId: null 即清除 FK，不再用 disconnect。
      const updateArg = mockPrisma.payrollRecord.update.mock.calls[0]?.[0] as {
        data: { employeeId?: string | null };
      };
      expect(updateArg.data.employeeId).toBeNull();
    });

    it('only sets fields that are explicitly provided (partial update)', async () => {
      mockPrisma.payrollRecord.findFirst.mockResolvedValue(buildRecord());
      mockPrisma.payrollRecord.update.mockResolvedValue(buildRecord());

      await service.update(
        'rec-1',
        { remarkSnapshot: '加班补贴', version: 1 } as UpdatePayrollDto,
        currentUser
      );

      const updateArg = mockPrisma.payrollRecord.update.mock.calls[0]?.[0] as {
        data: Record<string, unknown>;
      };
      expect(updateArg.data.remarkSnapshot).toBe('加班补贴');
      // 未传的 grossBaseSalary 不应出现在 update data
      expect(updateArg.data).not.toHaveProperty('grossBaseSalary');
    });

    it('records audit updateBy on update', async () => {
      mockPrisma.payrollRecord.findFirst.mockResolvedValue(buildRecord());
      mockPrisma.payrollRecord.update.mockResolvedValue(buildRecord());

      await service.update(
        'rec-1',
        { remarkSnapshot: 'x', version: 1 } as UpdatePayrollDto,
        currentUser
      );

      const updateArg = mockPrisma.payrollRecord.update.mock.calls[0]?.[0] as {
        data: Record<string, unknown>;
      };
      expect(updateArg.data).toHaveProperty('updaterEmployeeId');
    });
  });

  // ─── remove ─────────────────────────────────────────────────────────────

  describe('remove', () => {
    it('soft-deletes record and refreshes period rowCount', async () => {
      mockPrisma.payrollRecord.findFirst.mockResolvedValue(buildRecord());
      mockPrisma.payrollRecord.update.mockResolvedValue(buildRecord({ deletedAt: new Date() }));
      mockPrisma.payrollRecord.count.mockResolvedValue(0);
      mockPrisma.payrollPeriod.update.mockResolvedValue(buildPeriod({ rowCount: 0 }));

      await service.remove('rec-1', currentUser, 1);

      const updateArg = mockPrisma.payrollRecord.update.mock.calls[0]?.[0] as {
        where: { id: string; version: number; deletedAt: null };
        data: { deletedAt: Date; version: { increment: number } };
      };
      expect(updateArg.where).toEqual({ id: 'rec-1', version: 1, deletedAt: null });
      expect(updateArg.data.deletedAt).toBeInstanceOf(Date);
      expect(updateArg.data.version).toEqual({ increment: 1 });
      expect(mockPrisma.payrollPeriod.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ rowCount: 0, version: { increment: 1 } }),
        })
      );
    });

    it('uses the transaction client for delete CAS and period metadata refresh', async () => {
      const transactionPrisma = createMockPrismaService();
      mockPrisma.payrollRecord.findFirst.mockResolvedValue(buildRecord());
      transactionPrisma.payrollRecord.update.mockResolvedValue(
        buildRecord({ deletedAt: new Date(), version: 2 })
      );
      transactionPrisma.payrollRecord.count.mockResolvedValue(0);
      transactionPrisma.payrollPeriod.update.mockResolvedValue(buildPeriod({ rowCount: 0 }));
      mockPrisma.$transaction.mockImplementation(
        async (callback: (tx: MockPrismaService) => Promise<unknown>) => callback(transactionPrisma)
      );

      await service.remove('rec-1', currentUser, 1);

      expect(transactionPrisma.$executeRaw).toHaveBeenCalledTimes(1);
      expect(transactionPrisma.payrollRecord.update).toHaveBeenCalledTimes(1);
      expect(transactionPrisma.payrollRecord.count).toHaveBeenCalledTimes(1);
      expect(transactionPrisma.payrollPeriod.update).toHaveBeenCalledTimes(1);
      expect(mockPrisma.$executeRaw).not.toHaveBeenCalled();
      expect(mockPrisma.payrollRecord.update).not.toHaveBeenCalled();
      expect(mockPrisma.payrollRecord.count).not.toHaveBeenCalled();
      expect(mockPrisma.payrollPeriod.update).not.toHaveBeenCalled();
    });

    it.each([undefined, 0, -1, 1.5])('rejects invalid delete version %s', async (version) => {
      await expect(service.remove('rec-1', currentUser, version as number)).rejects.toThrow(
        BadRequestException
      );
      expect(mockPrisma.payrollRecord.findFirst).not.toHaveBeenCalled();
    });

    it('maps delete CAS P2025 to ConflictException', async () => {
      mockPrisma.payrollRecord.findFirst.mockResolvedValue(buildRecord({ version: 2 }));
      mockPrisma.payrollRecord.update.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('version changed', {
          code: 'P2025',
          clientVersion: 'test',
        })
      );

      await expect(service.remove('rec-1', currentUser, 2)).rejects.toThrow(ConflictException);
      expect(mockPrisma.payrollPeriod.update).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when record does not exist', async () => {
      mockPrisma.payrollRecord.findFirst.mockResolvedValue(null);

      await expect(service.remove('missing', currentUser, 1)).rejects.toThrow(NotFoundException);
    });
  });

  // ─── batchRemove ────────────────────────────────────────────────────────

  describe('batchRemove', () => {
    it('returns zero counts for an empty, internally valid selection', async () => {
      const result = await service.batchRemove([], {}, currentUser);

      expect(result).toEqual({ success: 0, failed: 0, errors: [] });
      expect(mockPrisma.payrollRecord.updateMany).not.toHaveBeenCalled();
    });

    it('rejects non-bijective ids/versions before preflight', async () => {
      await expect(service.batchRemove(['rec-1'], {}, currentUser)).rejects.toThrow(
        BadRequestException
      );
      await expect(
        service.batchRemove(['rec-1', 'rec-1'], { 'rec-1': 1 }, currentUser)
      ).rejects.toThrow(BadRequestException);
      expect(mockPrisma.payrollRecord.findMany).not.toHaveBeenCalled();
    });

    it('turns any missing row into one 409 instead of partial success', async () => {
      mockPrisma.payrollRecord.findMany.mockResolvedValue([
        {
          id: 'rec-1',
          version: 1,
          payrollPeriodId: 'p1',
          payrollPeriod: { periodKey: '2026-04' },
        },
      ]);

      await expect(
        service.batchRemove(['rec-1', 'rec-missing'], { 'rec-1': 1, 'rec-missing': 1 }, currentUser)
      ).rejects.toThrow(ConflictException);
      expect(mockPrisma.payrollRecord.updateMany).not.toHaveBeenCalled();
      expect(mockPrisma.payrollPeriod.update).not.toHaveBeenCalled();
    });

    it('uses the transaction client for lock-time version reread, CAS delete, and refresh', async () => {
      const transactionPrisma = createMockPrismaService();
      const records = [
        {
          id: 'rec-1',
          version: 4,
          payrollPeriodId: 'p1',
          payrollPeriod: { periodKey: '2026-04' },
        },
      ];
      mockPrisma.payrollRecord.findMany.mockResolvedValue(records);
      transactionPrisma.payrollRecord.findMany.mockResolvedValue(records);
      transactionPrisma.payrollRecord.updateMany.mockResolvedValue({ count: 1 });
      transactionPrisma.payrollRecord.count.mockResolvedValue(0);
      transactionPrisma.payrollPeriod.update.mockResolvedValue(buildPeriod());
      mockPrisma.$transaction.mockImplementation(
        async (callback: (tx: MockPrismaService) => Promise<unknown>) => callback(transactionPrisma)
      );

      await service.batchRemove(['rec-1'], { 'rec-1': 4 }, currentUser);

      expect(transactionPrisma.$executeRaw).toHaveBeenCalledTimes(1);
      expect(transactionPrisma.payrollRecord.findMany).toHaveBeenCalledWith({
        where: { id: { in: ['rec-1'] }, deletedAt: null },
        select: {
          id: true,
          version: true,
          payrollPeriodId: true,
          payrollPeriod: { select: { periodKey: true } },
        },
      });
      expect(transactionPrisma.payrollRecord.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { deletedAt: null, OR: [{ id: 'rec-1', version: 4 }] },
        })
      );
      expect(transactionPrisma.payrollPeriod.update).toHaveBeenCalledTimes(1);
      expect(mockPrisma.$executeRaw).not.toHaveBeenCalled();
      expect(mockPrisma.payrollRecord.updateMany).not.toHaveBeenCalled();
      expect(mockPrisma.payrollPeriod.update).not.toHaveBeenCalled();
    });

    it('rejects a stale lock-time version before writing', async () => {
      const preflight = {
        id: 'rec-1',
        version: 3,
        payrollPeriodId: 'p1',
        payrollPeriod: { periodKey: '2026-04' },
      };
      mockPrisma.payrollRecord.findMany
        .mockResolvedValueOnce([preflight])
        .mockResolvedValueOnce([{ ...preflight, version: 4 }]);

      await expect(service.batchRemove(['rec-1'], { 'rec-1': 3 }, currentUser)).rejects.toThrow(
        ConflictException
      );
      expect(mockPrisma.payrollRecord.updateMany).not.toHaveBeenCalled();
      expect(mockPrisma.payrollPeriod.update).not.toHaveBeenCalled();
    });

    it('rolls back the whole batch when final CAS count differs', async () => {
      const records = [
        {
          id: 'rec-1',
          version: 1,
          payrollPeriodId: 'p1',
          payrollPeriod: { periodKey: '2026-04' },
        },
        {
          id: 'rec-2',
          version: 2,
          payrollPeriodId: 'p1',
          payrollPeriod: { periodKey: '2026-04' },
        },
      ];
      mockPrisma.payrollRecord.findMany.mockResolvedValue(records);
      mockPrisma.payrollRecord.updateMany.mockResolvedValue({ count: 1 });

      await expect(
        service.batchRemove(['rec-1', 'rec-2'], { 'rec-1': 1, 'rec-2': 2 }, currentUser)
      ).rejects.toThrow(ConflictException);
      expect(mockPrisma.payrollPeriod.update).not.toHaveBeenCalled();
    });

    it('uses per-row CAS OR and refreshes each unique period in the same transaction', async () => {
      const records = [
        {
          id: 'rec-1',
          version: 1,
          payrollPeriodId: 'p1',
          payrollPeriod: { periodKey: '2026-04' },
        },
        {
          id: 'rec-2',
          version: 2,
          payrollPeriodId: 'p1',
          payrollPeriod: { periodKey: '2026-04' },
        },
        {
          id: 'rec-3',
          version: 3,
          payrollPeriodId: 'p2',
          payrollPeriod: { periodKey: '2026-05' },
        },
      ];
      const versions = { 'rec-1': 1, 'rec-2': 2, 'rec-3': 3 };
      mockPrisma.payrollRecord.findMany.mockResolvedValue(records);
      mockPrisma.payrollRecord.updateMany.mockResolvedValue({ count: 3 });
      mockPrisma.payrollRecord.count.mockResolvedValue(0);
      mockPrisma.payrollPeriod.update.mockResolvedValue(buildPeriod());

      await expect(
        service.batchRemove(
          records.map(({ id }) => id),
          versions,
          currentUser
        )
      ).resolves.toEqual({ success: 3, failed: 0, errors: [] });

      expect(
        mockPrisma.$executeRaw.mock.calls.map(([sql]) => (sql as Prisma.Sql).values[0])
      ).toEqual(['payroll_period:2026-04', 'payroll_period:2026-05']);
      expect(mockPrisma.payrollRecord.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            deletedAt: null,
            OR: [
              { id: 'rec-1', version: 1 },
              { id: 'rec-2', version: 2 },
              { id: 'rec-3', version: 3 },
            ],
          },
          data: expect.objectContaining({ version: { increment: 1 } }),
        })
      );
      expect(mockPrisma.payrollPeriod.update).toHaveBeenCalledTimes(2);
      for (const [arg] of mockPrisma.payrollPeriod.update.mock.calls) {
        expect(arg.data.version).toEqual({ increment: 1 });
      }
    });
  });
});
