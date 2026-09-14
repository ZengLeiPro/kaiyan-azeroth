import { payrollImportCommitResponseSchema } from '@ky-azeroth/shared/schemas';
import {
  BadRequestException,
  ConflictException,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
// eslint-disable-next-line no-restricted-imports -- 测试需要 mock child_process.spawn 以验证 PayrollImportService 调用 Python 解析器的行为(超时/错误/JSON 解析等分支)
import { spawn } from 'child_process';
import { EventEmitter } from 'events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  asPrismaService,
  createMockPrismaService,
  type MockPrismaService,
} from '../../../../test/prisma-mock.factory';
import { PayrollImportService } from '../payroll-import.service';

// ─── Module-level mocks ─────────────────────────────────────────────────────

vi.mock('child_process', () => ({
  spawn: vi.fn(),
}));

/**
 * 模拟一次 spawn:返回一个伪 ChildProcess(EventEmitter + stdout/stderr 流),
 * 然后异步地 emit data + 'close' code。
 */
function mockSpawnSuccess(stdoutJson: unknown) {
  const child = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
    kill: (sig: string) => void;
  };
  const stdout = new EventEmitter();
  const stderr = new EventEmitter();
  child.stdout = stdout;
  child.stderr = stderr;
  child.kill = vi.fn();

  vi.mocked(spawn).mockReturnValueOnce(child as unknown as ReturnType<typeof spawn>);

  // 等待 runPythonParser 完成 stdout/stderr/close 监听器注册后再发事件。
  setImmediate(() => {
    stdout.emit('data', JSON.stringify(stdoutJson));
    child.emit('close', 0);
  });
  return child;
}

function mockSpawnNonZeroExit(stderrText: string, code = 1) {
  const child = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
    kill: (sig: string) => void;
  };
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = vi.fn();

  vi.mocked(spawn).mockReturnValueOnce(child as unknown as ReturnType<typeof spawn>);

  setImmediate(() => {
    child.stderr.emit('data', stderrText);
    child.emit('close', code);
  });
  return child;
}

function mockSpawnError(err: Error) {
  const child = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
    kill: (sig: string) => void;
  };
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = vi.fn();

  vi.mocked(spawn).mockReturnValueOnce(child as unknown as ReturnType<typeof spawn>);

  setImmediate(() => {
    child.emit('error', err);
  });
  return child;
}

function mockSpawnInvalidJson() {
  const child = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
    kill: (sig: string) => void;
  };
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = vi.fn();

  vi.mocked(spawn).mockReturnValueOnce(child as unknown as ReturnType<typeof spawn>);

  setImmediate(() => {
    child.stdout.emit('data', 'not-json');
    child.emit('close', 0);
  });
  return child;
}

/** 不 emit close 也不超时设置,用于 fake timer 推进测试超时分支 */
function mockSpawnNoResponse() {
  const child = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
    kill: ReturnType<typeof vi.fn>;
  };
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = vi.fn();

  vi.mocked(spawn).mockReturnValueOnce(child as unknown as ReturnType<typeof spawn>);
  return child;
}

// ─── Fixtures ───────────────────────────────────────────────────────────────

type ParsedWorkbookForTest = {
  periods: Array<{
    records: Array<{
      employeeId: string | null;
      departmentId: string | null;
      employeeNameSnapshot: string;
      departmentNameSnapshot: string | null;
    }>;
  }>;
  errors: Array<{ message: string }>;
};

function emptyWorkbook(overrides: Record<string, unknown> = {}) {
  return {
    sourceFileName: 'payroll-2026-04.xlsx',
    totalSheets: 1,
    parsedSheets: 1,
    totalRows: 0,
    periods: [],
    warnings: [],
    errors: [],
    ...overrides,
  };
}

function workbookWithOneRecord() {
  return {
    sourceFileName: 'payroll-2026-04.xlsx',
    totalSheets: 1,
    parsedSheets: 1,
    totalRows: 1,
    periods: [
      {
        periodKey: '2026-04',
        year: 2026,
        month: 4,
        sheetName: '2026-04',
        companyName: '示例',
        expectedWorkDays: 22,
        statementDate: '2026-05-05',
        rowCount: 1,
        warnings: [],
        records: [
          {
            employeeId: null,
            departmentId: null,
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
            sourceSheetName: '2026-04',
            sourceRowIndex: 2,
            sourceRawJson: { rowNum: 2 },
          },
        ],
      },
    ],
    warnings: [],
    errors: [],
  };
}

// ─── Test suite ─────────────────────────────────────────────────────────────

describe('PayrollImportService', () => {
  let service: PayrollImportService;
  let mockPrisma: MockPrismaService;

  const currentUser = { id: 'admin-1', employeeId: 'emp-admin-1' };
  const fileHandle = {
    fd: 3,
    read: vi.fn(async (buffer: Buffer) => {
      Buffer.from([0x50, 0x4b, 0x03, 0x04]).copy(buffer);
      return { bytesRead: 4, buffer };
    }),
    close: vi.fn(async () => undefined),
  };
  const uploadService = {
    openRegisteredFileAsset: vi.fn(async () => ({
      handle: fileHandle,
      originalName: 'payroll.xlsx',
      storageKey: '20260904/payroll.xlsx',
      size: 1024,
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    })),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma = createMockPrismaService();
    service = new PayrollImportService(asPrismaService(mockPrisma), uploadService as never);
    // 默认空 employee/department 列表
    mockPrisma.employee.findMany.mockResolvedValue([]);
    mockPrisma.department.findMany.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('FileAsset / fd 安全边界', () => {
    it('缺少 FileAsset ID 时 fail-closed', async () => {
      await expect(service.previewImport('')).rejects.toThrow(BadRequestException);
    });

    it('只按 FileAsset ID 打开，不解析 URL/basename', async () => {
      mockSpawnSuccess(emptyWorkbook());
      await service.previewImport('11111111-1111-4111-8111-111111111111');
      expect(uploadService.openRegisteredFileAsset).toHaveBeenCalledWith(
        '11111111-1111-4111-8111-111111111111'
      );
      const spawnCall = vi.mocked(spawn).mock.calls[0];
      expect(spawnCall?.[1]).toEqual(expect.arrayContaining(['/proc/self/fd/3', 'payroll.xlsx']));
    });

    it('拒绝非 XLSX 资产元数据', async () => {
      uploadService.openRegisteredFileAsset.mockResolvedValueOnce({
        handle: fileHandle,
        originalName: 'payroll.csv',
        storageKey: '20260904/payroll.csv',
        size: 1024,
        mimeType: 'text/csv',
      });
      await expect(service.previewImport('asset-csv')).rejects.toThrow(BadRequestException);
    });
  });

  // ─── runPythonParser ────────────────────────────────────────────────────

  describe('runPythonParser (via previewImport)', () => {
    it('uses python3 + spawn (NOT shell exec)', async () => {
      mockSpawnSuccess(emptyWorkbook());
      await service.previewImport('file:///workspace/admin/uploads/data.xlsx');

      const spawnCall = vi.mocked(spawn).mock.calls[0];
      expect(spawnCall?.[0]).toBe('python3');
      // 安全:第二个参数是数组(不走 shell),包含脚本路径和文件路径
      expect(Array.isArray(spawnCall?.[1])).toBe(true);
    });

    it('limits env vars passed to python (no leak of full env)', async () => {
      mockSpawnSuccess(emptyWorkbook());
      await service.previewImport('file:///workspace/admin/uploads/data.xlsx');

      const spawnOpts = vi.mocked(spawn).mock.calls[0]?.[2] as { env?: Record<string, string> };
      expect(spawnOpts?.env).toBeDefined();
      // 只透传 PATH/HOME,不应有其他变量
      const envKeys = Object.keys(spawnOpts?.env ?? {});
      expect(envKeys.sort()).toEqual(['HOME', 'PATH']);
    });

    it('rejects with InternalServerErrorException on non-zero exit code', async () => {
      mockSpawnNonZeroExit('python error: invalid file', 1);

      await expect(
        service.previewImport('file:///workspace/admin/uploads/bad.xlsx')
      ).rejects.toThrow(InternalServerErrorException);
    });

    it('rejects with InternalServerErrorException when stdout is not valid JSON', async () => {
      mockSpawnInvalidJson();

      await expect(
        service.previewImport('file:///workspace/admin/uploads/bad.xlsx')
      ).rejects.toThrow(InternalServerErrorException);
    });

    it('rejects when spawn raises an error (e.g., python3 not installed)', async () => {
      mockSpawnError(new Error('ENOENT'));

      await expect(
        service.previewImport('file:///workspace/admin/uploads/data.xlsx')
      ).rejects.toThrow();
    });

    it('rejects with timeout error after 30s if python does not respond', async () => {
      vi.useFakeTimers();
      const child = mockSpawnNoResponse();

      const promise = service.previewImport('file:///workspace/admin/uploads/data.xlsx');
      // 立即把 promise 接住,避免 fake timer 推进后形成 unhandled rejection
      const result = promise.catch((err) => err);

      // 推进 30s 触发超时
      await vi.advanceTimersByTimeAsync(30_000);

      const err = await result;
      expect(err).toBeInstanceOf(InternalServerErrorException);
      expect((err as Error).message).toMatch(/30s/);
      expect(child.kill).toHaveBeenCalledWith('SIGKILL');
    });

    it('does NOT call kill if child finishes before timeout', async () => {
      vi.useFakeTimers();
      // 先注册 spawn
      const child = new EventEmitter() as EventEmitter & {
        stdout: EventEmitter;
        stderr: EventEmitter;
        kill: ReturnType<typeof vi.fn>;
      };
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.kill = vi.fn();
      vi.mocked(spawn).mockReturnValueOnce(child as unknown as ReturnType<typeof spawn>);

      const promise = service.previewImport('file:///workspace/admin/uploads/data.xlsx');
      // 推进时间(模拟在 5s 时完成)
      await vi.advanceTimersByTimeAsync(5_000);
      child.stdout.emit('data', JSON.stringify(emptyWorkbook()));
      child.emit('close', 0);

      await promise;
      expect(child.kill).not.toHaveBeenCalled();
    });
  });

  // ─── previewImport ──────────────────────────────────────────────────────

  describe('previewImport', () => {
    it('returns preview shape with periods and sample records', async () => {
      mockSpawnSuccess(workbookWithOneRecord());

      const result = await service.previewImport('file:///workspace/admin/uploads/payroll.xlsx');

      expect(result.sourceFileName).toBe('payroll-2026-04.xlsx');
      expect(result.totalSheets).toBe(1);
      expect(result.totalRows).toBe(1);
      expect(result.periods).toHaveLength(1);
      expect(result.periods[0]?.periodKey).toBe('2026-04');
      expect(result.periods[0]?.status).toBe('preview');
      expect(result.periods[0]?.id).toBe('preview:2026-04');
      expect(result.periods[0]?.sampleRecords).toHaveLength(1);
      expect(result.periods[0]?.sampleRecords[0]?.employeeNameSnapshot).toBe('张三');
    });

    it('recalculates totalLaborCost in preview and warns when Excel value differs', async () => {
      const wb = workbookWithOneRecord();
      wb.periods[0]!.records[0]!.totalLaborCost = 1;
      mockSpawnSuccess(wb);

      const result = await service.previewImport('file:///workspace/admin/uploads/payroll.xlsx');

      expect(result.periods[0]?.sampleRecords[0]?.totalLaborCost).toBe(14100);
      expect(
        result.periods[0]?.warnings.some((item) => item.message.includes('人工成本已按'))
      ).toBe(true);
    });

    it('truncates sampleRecords to 5 entries', async () => {
      const wb = workbookWithOneRecord();
      const rec = wb.periods[0]!.records[0]!;
      wb.periods[0]!.records = Array.from({ length: 12 }, (_, i) => ({
        ...rec,
        employeeNameSnapshot: `employee-${i}`,
      }));
      mockSpawnSuccess(wb);

      const result = await service.previewImport('file:///workspace/admin/uploads/p.xlsx');

      expect(result.periods[0]?.sampleRecords).toHaveLength(5);
      expect(result.periods[0]?.sampleRecords[0]?.employeeNameSnapshot).toBe('employee-0');
    });

    it('adds warning when employee not matched in db', async () => {
      mockSpawnSuccess(workbookWithOneRecord());
      // employees 库返回空,导致 matchEmployee 返回 null
      mockPrisma.employee.findMany.mockResolvedValue([]);

      const result = await service.previewImport('file:///workspace/admin/uploads/p.xlsx');

      const warnings = result.periods[0]?.warnings ?? [];
      expect(warnings.length).toBeGreaterThanOrEqual(1);
      expect(warnings[0]?.level).toBe('warning');
      expect(warnings[0]?.message).toContain('张三');
    });

    it('matches employee by name when single candidate', async () => {
      mockSpawnSuccess(workbookWithOneRecord());
      mockPrisma.employee.findMany.mockResolvedValue([
        {
          id: 'emp-zs',
          name: '张三',
          entryDate: new Date('2024-01-01'),
          departments: [],
        },
      ]);

      const result = await service.previewImport('file:///workspace/admin/uploads/p.xlsx');
      const warnings = result.periods[0]?.warnings ?? [];
      // 唯一候选 — 无 warning
      expect(warnings.length).toBe(0);
    });

    it('disambiguates by entryDate when multiple name matches', async () => {
      mockSpawnSuccess(workbookWithOneRecord());
      mockPrisma.employee.findMany.mockResolvedValue([
        {
          id: 'emp-zs-old',
          name: '张三',
          entryDate: new Date('2020-01-01'),
          departments: [],
        },
        {
          id: 'emp-zs-new',
          name: '张三',
          entryDate: new Date('2024-01-01'),
          departments: [],
        },
      ]);

      const result = await service.previewImport('file:///workspace/admin/uploads/p.xlsx');
      // 用 entryDate 2024-01-01 应解决歧义,无 warning
      const warnings = result.periods[0]?.warnings ?? [];
      expect(warnings).toHaveLength(0);
    });

    it('disambiguates by department when entryDate does not narrow it down', async () => {
      const wb = workbookWithOneRecord();
      (wb.periods[0]!.records[0]! as { entryDateSnapshot: string | null }).entryDateSnapshot = null;
      mockSpawnSuccess(wb);

      mockPrisma.employee.findMany.mockResolvedValue([
        {
          id: 'emp-a',
          name: '张三',
          entryDate: null,
          departments: [{ department: { name: '研发部' } }],
        },
        {
          id: 'emp-b',
          name: '张三',
          entryDate: null,
          departments: [{ department: { name: '销售部' } }],
        },
      ]);

      const result = await service.previewImport('file:///workspace/admin/uploads/p.xlsx');
      const warnings = result.periods[0]?.warnings ?? [];
      expect(warnings).toHaveLength(0);
    });

    it('matches employee and department with shared NFKC + whitespace normalization', async () => {
      const wb = workbookWithOneRecord();
      wb.periods[0]!.records[0]!.employeeNameSnapshot = 'Ａｌｉｃｅ　张';
      wb.periods[0]!.records[0]!.departmentNameSnapshot = '研　发 部';
      mockSpawnSuccess(wb);
      mockPrisma.employee.findMany.mockResolvedValue([
        {
          id: 'employee-alice',
          name: 'Alice张',
          entryDate: new Date('2024-01-01'),
          departments: [{ department: { name: '研发部' } }],
        },
      ]);
      mockPrisma.department.findMany.mockResolvedValue([
        { id: 'department-rd', name: '研发部', deletedAt: null },
      ]);

      const parsed = await (
        service as unknown as {
          parseWorkbook: (fileUrl: string) => Promise<ParsedWorkbookForTest>;
        }
      ).parseWorkbook('file:///workspace/admin/uploads/normalized.xlsx');

      expect(parsed.periods[0]!.records[0]).toEqual(
        expect.objectContaining({
          employeeNameSnapshot: 'Ａｌｉｃｅ　张',
          departmentNameSnapshot: '研　发 部',
          employeeId: 'employee-alice',
          departmentId: 'department-rd',
        })
      );
      expect(parsed.errors).toEqual([]);
    });

    it('detects duplicate identity across matched-id and unmatched-name maps', async () => {
      const wb = workbookWithOneRecord();
      const first = {
        ...wb.periods[0]!.records[0]!,
        entryDateSnapshot: '',
        departmentNameSnapshot: '研发部',
      };
      wb.periods[0]!.records = [
        first,
        {
          ...first,
          employeeNameSnapshot: ' 张 三 ',
          departmentNameSnapshot: '',
          sourceRowIndex: 3,
        },
      ];
      wb.periods[0]!.rowCount = 2;
      wb.totalRows = 2;
      mockSpawnSuccess(wb);
      mockPrisma.employee.findMany.mockResolvedValue([
        {
          id: 'employee-rd',
          name: '张三',
          entryDate: null,
          departments: [{ department: { name: '研发部' } }],
        },
        {
          id: 'employee-sales',
          name: '张三',
          entryDate: null,
          departments: [{ department: { name: '销售部' } }],
        },
      ]);

      const result = await service.previewImport(
        'file:///workspace/admin/uploads/cross-map-duplicate.xlsx'
      );

      expect(result.errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ message: expect.stringContaining('已匹配/未匹配交叉重复') }),
        ])
      );
    });

    it('keeps same normalized employee names distinct when departments disambiguate them', async () => {
      const wb = workbookWithOneRecord();
      const first = {
        ...wb.periods[0]!.records[0]!,
        entryDateSnapshot: '',
        departmentNameSnapshot: '研 发部',
      };
      wb.periods[0]!.records = [
        first,
        {
          ...first,
          employeeNameSnapshot: ' 张　三 ',
          departmentNameSnapshot: '销 售部',
          sourceRowIndex: 3,
        },
      ];
      wb.periods[0]!.rowCount = 2;
      wb.totalRows = 2;
      mockSpawnSuccess(wb);
      mockPrisma.employee.findMany.mockResolvedValue([
        {
          id: 'employee-rd',
          name: '张三',
          entryDate: null,
          departments: [{ department: { name: '研发部' } }],
        },
        {
          id: 'employee-sales',
          name: '张三',
          entryDate: null,
          departments: [{ department: { name: '销售部' } }],
        },
      ]);
      mockPrisma.department.findMany.mockResolvedValue([
        { id: 'department-rd', name: '研发部', deletedAt: null },
        { id: 'department-sales', name: '销售部', deletedAt: null },
      ]);

      const parsed = await (
        service as unknown as {
          parseWorkbook: (fileUrl: string) => Promise<ParsedWorkbookForTest>;
        }
      ).parseWorkbook('file:///workspace/admin/uploads/same-name-two-departments.xlsx');

      expect(
        parsed.periods[0]!.records.map(({ employeeId, departmentId }) => ({
          employeeId,
          departmentId,
        }))
      ).toEqual([
        { employeeId: 'employee-rd', departmentId: 'department-rd' },
        { employeeId: 'employee-sales', departmentId: 'department-sales' },
      ]);
      expect(parsed.errors.some((issue) => issue.message.includes('员工重复'))).toBe(false);
    });

    it('returns a clear preview error when no valid period exists', async () => {
      mockSpawnSuccess(emptyWorkbook());

      const result = await service.previewImport('file:///workspace/admin/uploads/empty.xlsx');

      expect(result.errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ message: expect.stringContaining('没有可导入的有效薪资期间') }),
        ])
      );
    });

    it('reports sheets that normalize to the same period', async () => {
      const wb = workbookWithOneRecord();
      const duplicatePeriod = {
        ...wb.periods[0]!,
        periodKey: '2026-4',
        sheetName: '四月工资（副本）',
        records: wb.periods[0]!.records.map((record) => ({
          ...record,
          sourceSheetName: '四月工资（副本）',
        })),
      };
      wb.periods = [wb.periods[0]!, duplicatePeriod];
      wb.totalSheets = 2;
      wb.parsedSheets = 2;
      wb.totalRows = 2;
      mockSpawnSuccess(wb);

      const result = await service.previewImport('file:///workspace/admin/uploads/duplicate.xlsx');

      expect(result.errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            sheetName: '四月工资（副本）',
            message: expect.stringContaining('归一为同一期间'),
          }),
        ])
      );
      expect(result.periods.map((period) => period.periodKey)).toEqual(['2026-04', '2026-04']);
    });

    it('reports duplicate matched employee IDs within a period', async () => {
      const wb = workbookWithOneRecord();
      const first = wb.periods[0]!.records[0]!;
      wb.periods[0]!.records = [
        first,
        { ...first, employeeNameSnapshot: '张三', sourceRowIndex: 3 },
      ];
      wb.periods[0]!.rowCount = 2;
      wb.totalRows = 2;
      mockPrisma.employee.findMany.mockResolvedValue([
        {
          id: 'emp-zs',
          name: '张三',
          entryDate: new Date('2024-01-01'),
          departments: [],
        },
      ]);
      mockSpawnSuccess(wb);

      const result = await service.previewImport(
        'file:///workspace/admin/uploads/employee-id.xlsx'
      );

      expect(result.errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ message: expect.stringContaining('员工 ID emp-zs') }),
        ])
      );
    });

    it('uses normalized name plus department to distinguish unmatched names', async () => {
      const wb = workbookWithOneRecord();
      const first = wb.periods[0]!.records[0]!;
      wb.periods[0]!.records = [
        first,
        {
          ...first,
          employeeNameSnapshot: ' 张 三 ',
          departmentNameSnapshot: '销售部',
          sourceRowIndex: 3,
        },
      ];
      wb.periods[0]!.rowCount = 2;
      wb.totalRows = 2;
      mockSpawnSuccess(wb);

      const result = await service.previewImport('file:///workspace/admin/uploads/same-name.xlsx');

      expect(result.errors.some((issue) => issue.message.includes('员工重复'))).toBe(false);
    });

    it('uses entry date to distinguish unmatched names in the same department', async () => {
      const wb = workbookWithOneRecord();
      const first = wb.periods[0]!.records[0]!;
      wb.periods[0]!.records = [
        first,
        {
          ...first,
          employeeNameSnapshot: ' 张 三 ',
          entryDateSnapshot: '2023-01-01',
          sourceRowIndex: 3,
        },
      ];
      wb.periods[0]!.rowCount = 2;
      wb.totalRows = 2;
      mockSpawnSuccess(wb);

      const result = await service.previewImport(
        'file:///workspace/admin/uploads/same-name-entry-date.xlsx'
      );

      expect(result.errors.some((issue) => issue.message.includes('员工重复'))).toBe(false);
    });
  });

  // ─── commitImport ───────────────────────────────────────────────────────

  describe('commitImport', () => {
    function wireCommitMocks(
      workbook = workbookWithOneRecord(),
      transactionPrisma: MockPrismaService = mockPrisma
    ) {
      mockSpawnSuccess(workbook);
      transactionPrisma.payrollImportBatch.create.mockResolvedValue({
        id: 'batch-1',
        sourceFileName: workbook.sourceFileName,
      });
      transactionPrisma.payrollPeriod.findUnique.mockResolvedValue(null);
      transactionPrisma.payrollPeriod.create.mockResolvedValue({
        id: 'period-202604',
        periodKey: '2026-04',
      });
      transactionPrisma.payrollPeriod.update.mockResolvedValue({ id: 'period-old' });
      transactionPrisma.payrollRecord.createMany.mockResolvedValue({ count: 1 });
      transactionPrisma.payrollImportBatch.update.mockResolvedValue({
        id: 'batch-1',
        sourceFileName: workbook.sourceFileName,
        totalSheets: workbook.totalSheets,
        parsedSheets: workbook.parsedSheets,
        totalRows: workbook.totalRows,
        successRows: workbook.totalRows,
        failedRows: 0,
        skippedRows: 0,
        strategy: 'replace_period',
        status: 'completed',
        summaryJson: null,
        errorReportJson: null,
        periods: [],
      });
    }

    it('throws BadRequestException for unsupported strategy', async () => {
      await expect(
        service.commitImport('file:///workspace/admin/uploads/p.xlsx', 'merge', currentUser)
      ).rejects.toThrow(BadRequestException);
    });

    it('返回值满足 shared commit response 契约', async () => {
      wireCommitMocks();

      const result = await service.commitImport(
        '11111111-1111-4111-8111-111111111111',
        'replace_period',
        currentUser
      );

      expect(payrollImportCommitResponseSchema.safeParse(result).success).toBe(true);
    });

    it('throws BadRequestException when workbook has errors', async () => {
      mockSpawnSuccess(
        emptyWorkbook({
          errors: [{ level: 'error', message: '表头不正确', sheetName: 's1', rowIndex: 1 }],
        })
      );

      await expect(
        service.commitImport(
          'file:///workspace/admin/uploads/p.xlsx',
          'replace_period',
          currentUser
        )
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects an empty workbook without creating a completed batch', async () => {
      mockSpawnSuccess(emptyWorkbook());

      await expect(
        service.commitImport(
          'file:///workspace/admin/uploads/empty.xlsx',
          'replace_period',
          currentUser
        )
      ).rejects.toThrow(/没有可导入的有效薪资期间/);

      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
      expect(mockPrisma.payrollImportBatch.create).not.toHaveBeenCalled();
    });

    it('rejects totalRows that differs from final records before the transaction', async () => {
      const wb = workbookWithOneRecord();
      wb.totalRows = 2;
      mockSpawnSuccess(wb);

      await expect(
        service.commitImport(
          'file:///workspace/admin/uploads/count-mismatch.xlsx',
          'replace_period',
          currentUser
        )
      ).rejects.toThrow(/总行数不一致/);

      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });

    it('rejects duplicate normalized periods before any replacement write', async () => {
      const wb = workbookWithOneRecord();
      wb.periods = [
        wb.periods[0]!,
        { ...wb.periods[0]!, periodKey: '2026-4', sheetName: 'duplicate-april' },
      ];
      wb.totalSheets = 2;
      wb.parsedSheets = 2;
      wb.totalRows = 2;
      mockSpawnSuccess(wb);

      await expect(
        service.commitImport(
          'file:///workspace/admin/uploads/duplicate-period.xlsx',
          'replace_period',
          currentUser
        )
      ).rejects.toThrow(/归一为同一期间/);

      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
      expect(mockPrisma.payrollRecord.updateMany).not.toHaveBeenCalled();
    });

    it('rejects duplicate unmatched normalized name/department keys', async () => {
      const wb = workbookWithOneRecord();
      const first = wb.periods[0]!.records[0]!;
      wb.periods[0]!.records = [
        first,
        { ...first, employeeNameSnapshot: ' 张 三 ', sourceRowIndex: 3 },
      ];
      wb.periods[0]!.rowCount = 2;
      wb.totalRows = 2;
      mockSpawnSuccess(wb);

      await expect(
        service.commitImport(
          'file:///workspace/admin/uploads/duplicate-employee.xlsx',
          'replace_period',
          currentUser
        )
      ).rejects.toThrow(/员工重复/);

      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
      expect(mockPrisma.payrollRecord.createMany).not.toHaveBeenCalled();
    });

    it('acquires the normalized period advisory lock before findUnique', async () => {
      const workbook = workbookWithOneRecord();
      workbook.periods[0]!.periodKey = '2026-4';
      wireCommitMocks(workbook);

      await service.commitImport(
        'file:///workspace/admin/uploads/p.xlsx',
        'replace_period',
        currentUser
      );

      expect(mockPrisma.$executeRaw).toHaveBeenCalledTimes(1);
      const lockSql = mockPrisma.$executeRaw.mock.calls[0]?.[0] as Prisma.Sql;
      expect(lockSql.sql).toBe('SELECT pg_advisory_xact_lock(hashtextextended(?, 0))');
      expect(lockSql.values).toEqual(['payroll_period:2026-04']);
      expect(mockPrisma.payrollPeriod.findUnique).toHaveBeenCalledWith({
        where: { periodKey: '2026-04' },
      });
      const [lockOrder] = mockPrisma.$executeRaw.mock.invocationCallOrder;
      const [findOrder] = mockPrisma.payrollPeriod.findUnique.mock.invocationCallOrder;
      expect(lockOrder).toBeDefined();
      expect(findOrder).toBeDefined();
      expect(lockOrder as number).toBeLessThan(findOrder as number);
    });

    it('derives a stable lock key from equivalent periodKey spellings', async () => {
      const firstWorkbook = workbookWithOneRecord();
      firstWorkbook.periods[0]!.periodKey = '2026-4';
      wireCommitMocks(firstWorkbook);
      await service.commitImport(
        'file:///workspace/admin/uploads/first.xlsx',
        'replace_period',
        currentUser
      );

      const secondWorkbook = workbookWithOneRecord();
      secondWorkbook.periods[0]!.periodKey = ' 2026-04 ';
      wireCommitMocks(secondWorkbook);
      await service.commitImport(
        'file:///workspace/admin/uploads/second.xlsx',
        'replace_period',
        currentUser
      );

      const lockQueries = mockPrisma.$executeRaw.mock.calls.map(([query]) => query as Prisma.Sql);
      expect(lockQueries).toHaveLength(2);
      expect(lockQueries[0]?.values).toEqual(['payroll_period:2026-04']);
      expect(lockQueries[1]?.values).toEqual(lockQueries[0]?.values);
      expect(lockQueries[1]?.sql).toBe(lockQueries[0]?.sql);
    });

    it('uses the transaction client for the lock, soft delete, and replacement insert', async () => {
      const transactionPrisma = createMockPrismaService();
      wireCommitMocks(workbookWithOneRecord(), transactionPrisma);
      transactionPrisma.payrollPeriod.findUnique.mockResolvedValue({
        id: 'period-old',
        periodKey: '2026-04',
        version: 7,
      });
      mockPrisma.$transaction.mockImplementation(
        async (callback: (tx: MockPrismaService) => Promise<unknown>) => callback(transactionPrisma)
      );

      await service.commitImport(
        'file:///workspace/admin/uploads/p.xlsx',
        'replace_period',
        currentUser
      );

      expect(transactionPrisma.$executeRaw).toHaveBeenCalledTimes(1);
      expect(transactionPrisma.payrollImportBatch.create).toHaveBeenCalledTimes(1);
      expect(transactionPrisma.payrollPeriod.findUnique).toHaveBeenCalledTimes(1);
      expect(transactionPrisma.payrollPeriod.update).toHaveBeenCalledTimes(1);
      expect(transactionPrisma.payrollPeriod.create).not.toHaveBeenCalled();
      expect(transactionPrisma.payrollRecord.updateMany).toHaveBeenCalledTimes(1);
      expect(transactionPrisma.payrollRecord.createMany).toHaveBeenCalledTimes(1);
      expect(transactionPrisma.payrollImportBatch.update).toHaveBeenCalledTimes(1);
      expect(mockPrisma.$executeRaw).not.toHaveBeenCalled();
      expect(mockPrisma.payrollImportBatch.create).not.toHaveBeenCalled();
      expect(mockPrisma.payrollPeriod.findUnique).not.toHaveBeenCalled();
      expect(mockPrisma.payrollPeriod.update).not.toHaveBeenCalled();
      expect(mockPrisma.payrollRecord.updateMany).not.toHaveBeenCalled();
      expect(mockPrisma.payrollRecord.createMany).not.toHaveBeenCalled();
    });

    it('creates import batch with audit fields', async () => {
      wireCommitMocks();

      await service.commitImport(
        'file:///workspace/admin/uploads/p.xlsx',
        'replace_period',
        currentUser
      );

      expect(mockPrisma.payrollImportBatch.create).toHaveBeenCalledTimes(1);
      const createArg = mockPrisma.payrollImportBatch.create.mock.calls[0]?.[0] as {
        data: Record<string, unknown>;
      };
      expect(createArg.data.status).toBe('completed');
      expect(createArg.data.strategy).toBe('replace_period');
      expect(createArg.data).toHaveProperty('creatorEmployeeId');
    });

    it('replace_period: 复用已有期间并替换旧记录', async () => {
      wireCommitMocks();
      // 模拟"已有 period"
      mockPrisma.payrollPeriod.findUnique.mockResolvedValue({
        id: 'period-old',
        periodKey: '2026-04',
        version: 7,
      });

      await service.commitImport(
        'file:///workspace/admin/uploads/p.xlsx',
        'replace_period',
        currentUser
      );

      expect(mockPrisma.payrollRecord.updateMany).toHaveBeenCalledTimes(1);
      expect(mockPrisma.payrollPeriod.update).toHaveBeenCalledTimes(1);
      expect(mockPrisma.payrollPeriod.create).not.toHaveBeenCalled();
      const recordsArg = mockPrisma.payrollRecord.updateMany.mock.calls[0]?.[0] as {
        where: { payrollPeriodId: string };
        data: { deletedAt: Date; version: { increment: number } };
      };
      expect(recordsArg.where.payrollPeriodId).toBe('period-old');
      expect(recordsArg.data.deletedAt).toBeInstanceOf(Date);
      expect(recordsArg.data.version).toEqual({ increment: 1 });
      const periodArg = mockPrisma.payrollPeriod.update.mock.calls[0]?.[0] as {
        where: { id: string; version: number };
        data: { deletedAt: null; version: { increment: number } };
      };
      expect(periodArg.where).toEqual({ id: 'period-old', version: 7 });
      expect(periodArg.data.deletedAt).toBeNull();
      expect(periodArg.data.version).toEqual({ increment: 1 });
      expect(mockPrisma.payrollRecord.createMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.arrayContaining([
            expect.objectContaining({ payrollPeriodId: 'period-old' }),
          ]),
        })
      );
    });

    it('maps an existing-period version CAS failure to ConflictException', async () => {
      wireCommitMocks();
      mockPrisma.payrollPeriod.findUnique.mockResolvedValue({
        id: 'period-old',
        periodKey: '2026-04',
        version: 7,
      });
      mockPrisma.payrollPeriod.update.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('period version changed', {
          code: 'P2025',
          clientVersion: 'test',
        })
      );

      await expect(
        service.commitImport(
          'file:///workspace/admin/uploads/p.xlsx',
          'replace_period',
          currentUser
        )
      ).rejects.toThrow(ConflictException);

      expect(mockPrisma.payrollRecord.updateMany).toHaveBeenCalledTimes(1);
      expect(mockPrisma.payrollRecord.createMany).not.toHaveBeenCalled();
      expect(mockPrisma.payrollImportBatch.update).not.toHaveBeenCalled();
    });

    it('propagates write errors out of the transaction callback for rollback', async () => {
      wireCommitMocks();
      const writeError = new Error('createMany failed');
      mockPrisma.payrollRecord.createMany.mockRejectedValue(writeError);
      let transactionRejected = false;
      mockPrisma.$transaction.mockImplementation(
        async (callback: (tx: MockPrismaService) => Promise<unknown>) => {
          try {
            return await callback(mockPrisma);
          } catch (error) {
            transactionRejected = true;
            throw error;
          }
        }
      );

      await expect(
        service.commitImport(
          'file:///workspace/admin/uploads/p.xlsx',
          'replace_period',
          currentUser
        )
      ).rejects.toBe(writeError);

      expect(transactionRejected).toBe(true);
      expect(mockPrisma.payrollPeriod.create).toHaveBeenCalledTimes(1);
      expect(mockPrisma.payrollImportBatch.update).not.toHaveBeenCalled();
    });

    it('creates new period with imported status', async () => {
      wireCommitMocks();

      await service.commitImport(
        'file:///workspace/admin/uploads/p.xlsx',
        'replace_period',
        currentUser
      );

      const createArg = mockPrisma.payrollPeriod.create.mock.calls[0]?.[0] as {
        data: Record<string, unknown>;
      };
      expect(createArg.data.periodKey).toBe('2026-04');
      expect(createArg.data.year).toBe(2026);
      expect(createArg.data.month).toBe(4);
      expect(createArg.data.status).toBe('imported');
    });

    it('writes Decimal fields as String() (precision-safe)', async () => {
      wireCommitMocks();

      await service.commitImport(
        'file:///workspace/admin/uploads/p.xlsx',
        'replace_period',
        currentUser
      );

      const recordsArg = mockPrisma.payrollRecord.createMany.mock.calls[0]?.[0] as {
        data: Array<Record<string, unknown>>;
      };
      const firstRecord = recordsArg.data[0];
      expect(firstRecord).toBeDefined();
      expect(typeof firstRecord!.grossBaseSalary).toBe('string');
      expect(firstRecord!.grossBaseSalary).toBe('10000');
      expect(firstRecord!.netSalary).toBe('10700');
      expect(typeof firstRecord!.expectedWorkDays).not.toBe('number'); // not in record(只在 period)
    });

    it('writes recalculated totalLaborCost on commit', async () => {
      const wb = workbookWithOneRecord();
      wb.periods[0]!.records[0]!.totalLaborCost = 1;
      wireCommitMocks(wb);

      await service.commitImport(
        'file:///workspace/admin/uploads/p.xlsx',
        'replace_period',
        currentUser
      );

      const recordsArg = mockPrisma.payrollRecord.createMany.mock.calls[0]?.[0] as {
        data: Array<{ totalLaborCost: string }>;
      };
      expect(recordsArg.data[0]!.totalLaborCost).toBe('14100');
    });

    it('preserves Decimal precision via String (no float drift)', async () => {
      const wb = workbookWithOneRecord();
      // 模拟一个会产生浮点漂移的输入(若用 toFixed 等会精度损失)
      wb.periods[0]!.records[0]!.grossOther = 0.1 + 0.2; // 0.30000000000000004 in JS
      wireCommitMocks(wb);

      await service.commitImport(
        'file:///workspace/admin/uploads/p.xlsx',
        'replace_period',
        currentUser
      );

      const recordsArg = mockPrisma.payrollRecord.createMany.mock.calls[0]?.[0] as {
        data: Array<{ grossOther: string }>;
      };
      // String() 会保留 JS 的浮点输出(虽然有漂移,但传给 Decimal 时按字符串精确解析,
      // 这里只断言 String() 化,即未走 number→Prisma.Decimal 的不安全路径)
      expect(typeof recordsArg.data[0]!.grossOther).toBe('string');
    });

    it('null Decimal fields stay null (not "null" string)', async () => {
      const wb = workbookWithOneRecord();
      const rec = wb.periods[0]!.records[0]! as {
        grossPerformance: number | null;
        grossCommission: number | null;
      };
      rec.grossPerformance = null;
      rec.grossCommission = null;
      wireCommitMocks(wb);

      await service.commitImport(
        'file:///workspace/admin/uploads/p.xlsx',
        'replace_period',
        currentUser
      );

      const recordsArg = mockPrisma.payrollRecord.createMany.mock.calls[0]?.[0] as {
        data: Array<{ grossPerformance: string | null; grossCommission: string | null }>;
      };
      expect(recordsArg.data[0]!.grossPerformance).toBeNull();
      expect(recordsArg.data[0]!.grossCommission).toBeNull();
    });

    it('runs inside a single $transaction', async () => {
      wireCommitMocks();

      await service.commitImport(
        'file:///workspace/admin/uploads/p.xlsx',
        'replace_period',
        currentUser
      );

      expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
    });

    it('rejects a period with zero records before opening a transaction', async () => {
      const wb = workbookWithOneRecord();
      wb.periods[0]!.records = [];
      wb.periods[0]!.rowCount = 0;
      wb.totalRows = 0;
      mockSpawnSuccess(wb);

      await expect(
        service.commitImport(
          'file:///workspace/admin/uploads/p.xlsx',
          'replace_period',
          currentUser
        )
      ).rejects.toThrow(/不允许隐式清空期间/);

      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
      expect(mockPrisma.payrollImportBatch.create).not.toHaveBeenCalled();
      expect(mockPrisma.payrollRecord.updateMany).not.toHaveBeenCalled();
    });

    it('handles multiple periods in a single workbook', async () => {
      const wb = workbookWithOneRecord();
      const period2 = {
        ...wb.periods[0]!,
        periodKey: '2026-05',
        year: 2026,
        month: 5,
        sheetName: '2026-05',
      };
      wb.periods = [period2, wb.periods[0]!];
      wb.parsedSheets = 2;
      wb.totalSheets = 2;
      wb.totalRows = 2;
      wireCommitMocks(wb);

      await service.commitImport(
        'file:///workspace/admin/uploads/p.xlsx',
        'replace_period',
        currentUser
      );

      // 2 个 period 各创建一次；即使 workbook 倒序，也按 periodKey 排序获取锁。
      expect(mockPrisma.payrollPeriod.create).toHaveBeenCalledTimes(2);
      expect(
        mockPrisma.$executeRaw.mock.calls.map(([sql]) => (sql as Prisma.Sql).values[0])
      ).toEqual(['payroll_period:2026-04', 'payroll_period:2026-05']);
    });

    it('updates batch summary at the end with createdRecords count', async () => {
      wireCommitMocks();

      await service.commitImport(
        'file:///workspace/admin/uploads/p.xlsx',
        'replace_period',
        currentUser
      );

      expect(mockPrisma.payrollImportBatch.update).toHaveBeenCalledTimes(1);
      const updateArg = mockPrisma.payrollImportBatch.update.mock.calls[0]?.[0] as {
        where: { id: string };
        data: { summaryJson: { createdRecords: number } | unknown };
      };
      expect(updateArg.where.id).toBe('batch-1');
      // toJsonValue 包装后的形式,这里粗略验证 summaryJson 字段存在
      expect(updateArg.data.summaryJson).toBeDefined();
    });

    it('expectedWorkDays:null is preserved as null in DB', async () => {
      const wb = workbookWithOneRecord();
      (wb.periods[0]! as { expectedWorkDays: number | null }).expectedWorkDays = null;
      wireCommitMocks(wb);

      await service.commitImport(
        'file:///workspace/admin/uploads/p.xlsx',
        'replace_period',
        currentUser
      );

      const periodArg = mockPrisma.payrollPeriod.create.mock.calls[0]?.[0] as {
        data: { expectedWorkDays: string | null };
      };
      expect(periodArg.data.expectedWorkDays).toBeNull();
    });

    it('expectedWorkDays:number is stringified for Decimal column', async () => {
      const wb = workbookWithOneRecord();
      wb.periods[0]!.expectedWorkDays = 21.5;
      wireCommitMocks(wb);

      await service.commitImport(
        'file:///workspace/admin/uploads/p.xlsx',
        'replace_period',
        currentUser
      );

      const periodArg = mockPrisma.payrollPeriod.create.mock.calls[0]?.[0] as {
        data: { expectedWorkDays: string | null };
      };
      expect(typeof periodArg.data.expectedWorkDays).toBe('string');
      expect(periodArg.data.expectedWorkDays).toBe('21.5');
    });

    it('statementDate string is parsed to Date', async () => {
      wireCommitMocks();

      await service.commitImport(
        'file:///workspace/admin/uploads/p.xlsx',
        'replace_period',
        currentUser
      );

      const periodArg = mockPrisma.payrollPeriod.create.mock.calls[0]?.[0] as {
        data: { statementDate: Date | null };
      };
      expect(periodArg.data.statementDate).toBeInstanceOf(Date);
    });

    it('connects employeeId/departmentId after matching', async () => {
      wireCommitMocks();
      mockPrisma.employee.findMany.mockResolvedValue([
        {
          id: 'emp-matched-1',
          name: '张三',
          entryDate: new Date('2024-01-01'),
          departments: [],
        },
      ]);
      mockPrisma.department.findMany.mockResolvedValue([
        { id: 'dept-matched-1', name: '研发部', deletedAt: null },
      ]);

      await service.commitImport(
        'file:///workspace/admin/uploads/p.xlsx',
        'replace_period',
        currentUser
      );

      const recordsArg = mockPrisma.payrollRecord.createMany.mock.calls[0]?.[0] as {
        data: Array<{ employeeId: string | null; departmentId: string | null }>;
      };
      expect(recordsArg.data[0]!.employeeId).toBe('emp-matched-1');
      expect(recordsArg.data[0]!.departmentId).toBe('dept-matched-1');
    });
  });

  // ─── listImportBatches ──────────────────────────────────────────────────

  describe('listImportBatches', () => {
    it('returns batches ordered by createdAt desc, excluding deleted', async () => {
      mockPrisma.payrollImportBatch.findMany.mockResolvedValue([
        { id: 'b1', createdAt: new Date('2026-05-01'), periods: [] },
        { id: 'b2', createdAt: new Date('2026-04-01'), periods: [] },
      ]);

      const result = await service.listImportBatches();

      expect(result.items).toHaveLength(2);
      const findArg = mockPrisma.payrollImportBatch.findMany.mock.calls[0]?.[0] as {
        where: { deletedAt: null };
        orderBy: { createdAt: string };
      };
      expect(findArg.where.deletedAt).toBeNull();
      expect(findArg.orderBy.createdAt).toBe('desc');
    });

    it('includes only non-deleted periods sorted by year/month desc', async () => {
      mockPrisma.payrollImportBatch.findMany.mockResolvedValue([]);
      await service.listImportBatches();

      const findArg = mockPrisma.payrollImportBatch.findMany.mock.calls[0]?.[0] as {
        include: { periods: { where: { deletedAt: null }; orderBy: unknown[] } };
      };
      expect(findArg.include.periods.where.deletedAt).toBeNull();
      expect(findArg.include.periods.orderBy).toEqual([{ year: 'desc' }, { month: 'desc' }]);
    });
  });

  // ─── getImportBatch ─────────────────────────────────────────────────────

  describe('getImportBatch', () => {
    it('returns batch when found', async () => {
      mockPrisma.payrollImportBatch.findFirst.mockResolvedValue({
        id: 'batch-x',
        periods: [],
      });

      const result = await service.getImportBatch('batch-x');

      expect((result as { id: string }).id).toBe('batch-x');
    });

    it('throws NotFoundException when batch not found', async () => {
      mockPrisma.payrollImportBatch.findFirst.mockResolvedValue(null);

      await expect(service.getImportBatch('missing')).rejects.toThrow(NotFoundException);
    });

    it('excludes soft-deleted batches', async () => {
      mockPrisma.payrollImportBatch.findFirst.mockResolvedValue(null);

      await expect(service.getImportBatch('soft-del')).rejects.toThrow(NotFoundException);

      const findArg = mockPrisma.payrollImportBatch.findFirst.mock.calls[0]?.[0] as {
        where: { id: string; deletedAt: null };
      };
      expect(findArg.where.deletedAt).toBeNull();
    });
  });
});
