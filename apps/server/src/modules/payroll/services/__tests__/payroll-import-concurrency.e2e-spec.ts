import { ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { PrismaService } from '../../../../common/prisma/prisma.service';
import { PayrollService } from '../../payroll.service';
import { PayrollImportService } from '../payroll-import.service';

type Deferred = {
  promise: Promise<void>;
  resolve: () => void;
  reject: (error: unknown) => void;
};

type LockHooks = {
  beforeAttempt?: (backendPid: number) => void | Promise<void>;
  afterDispatch?: (backendPid: number) => void | Promise<void>;
  afterAcquire?: (backendPid: number) => void | Promise<void>;
};

function createDeferred(): Deferred {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<void>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

/**
 * 只包装真实 Prisma interactive transaction 的 transaction client，在 advisory lock
 * 调用前后挂可控 barrier；所有 SQL 仍由独立 PostgreSQL 连接真实执行。
 */
function withLockHooks(prisma: PrismaService, hooks: LockHooks): PrismaService {
  const transactionOnlyClient = {
    $transaction<T>(callback: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
      return prisma.$transaction(
        async (tx) => {
          const hookedTx = new Proxy(tx, {
            get(target, property) {
              if (property === '$executeRaw') {
                return async (query: Prisma.Sql) => {
                  // @prisma-raw-sql: 真实 PG E2E 记录当前 transaction connection pid，用于从独立连接验证 advisory lock 等待态。
                  const [session] = await target.$queryRaw<Array<{ pid: number }>>(
                    Prisma.sql`SELECT pg_backend_pid() AS pid`
                  );
                  const backendPid = session?.pid;
                  if (!backendPid) throw new Error('无法读取 PostgreSQL backend pid');
                  await hooks.beforeAttempt?.(backendPid);
                  // @prisma-raw-sql: 测试代理原样转发 payroll period advisory-lock SQL，仅在真实获取锁前后挂 barrier。
                  const lockRequest = Promise.resolve(target.$executeRaw(query));
                  await hooks.afterDispatch?.(backendPid);
                  const result = await lockRequest;
                  await hooks.afterAcquire?.(backendPid);
                  return result;
                };
              }
              return Reflect.get(target, property, target);
            },
          });
          return callback(hookedTx);
        },
        { timeout: 10_000 }
      );
    },
  };
  return transactionOnlyClient as unknown as PrismaService;
}

async function expectAdvisoryLockWait(observer: PrismaService, backendPid: number) {
  const deadline = Date.now() + 3_000;
  while (Date.now() < deadline) {
    // @prisma-raw-sql: 真实 PG E2E 从独立连接观察目标 backend 的 lock wait_event，证明请求已发到数据库且尚未获锁。
    const [activity] = await observer.$queryRaw<
      Array<{
        state: string;
        waitEventType: string | null;
        waitEvent: string | null;
        query: string;
      }>
    >(Prisma.sql`
      SELECT
        state,
        wait_event_type AS "waitEventType",
        wait_event AS "waitEvent",
        query
      FROM pg_stat_activity
      WHERE pid = ${backendPid}
    `);
    if (activity?.waitEventType === 'Lock' && activity.waitEvent === 'advisory') {
      expect(activity.state).toBe('active');
      expect(activity.query).toContain('pg_advisory_xact_lock');
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`backend ${backendPid} 未在期限内进入 advisory lock 等待态`);
}

function parsedWorkbook(sourceFileName: string, employeeNameSnapshot: string) {
  return {
    sourceFileName,
    totalSheets: 1,
    parsedSheets: 1,
    totalRows: 1,
    periods: [
      {
        periodKey: '2026-4',
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
            employeeNameSnapshot,
            departmentNameSnapshot: null,
            positionSnapshot: null,
            entryDateSnapshot: null,
            bankNameSnapshot: null,
            bankCardNoSnapshot: null,
            remarkSnapshot: null,
            actualAttendanceDays: null,
            absenceDays: null,
            grossBaseSalary: null,
            grossPerformance: null,
            grossCommission: null,
            grossOther: null,
            grossBonusYearEnd: null,
            grossTotal: null,
            absenceDeductionAmount: null,
            lateDeductionAmount: null,
            adminDeductionAmount: null,
            socialSecurityPersonalAmount: null,
            housingFundPersonalAmount: null,
            deductionOtherTotal: null,
            deductionTotal: null,
            socialSecurityCompanyAmount: null,
            housingFundCompanyAmount: null,
            companyBurdenTotal: null,
            netSalary: null,
            totalLaborCost: null,
            sourceSheetName: '2026-04',
            sourceRowIndex: 6,
            sourceRawJson: null,
          },
        ],
      },
    ],
    warnings: [],
    errors: [],
  };
}

function stubParsedWorkbook(service: PayrollImportService, workbook: unknown) {
  return vi
    .spyOn(
      service as unknown as {
        parseWorkbook: (fileAssetId: string, ownerEmployeeId: string) => Promise<unknown>;
      },
      'parseWorkbook'
    )
    .mockResolvedValue(workbook);
}

describe('PayrollImportService replace_period concurrency E2E', () => {
  let firstPrisma: PrismaService;
  let secondPrisma: PrismaService;
  let observerPrisma: PrismaService;
  let currentUser: { id: string; employeeId: string };

  beforeAll(async () => {
    firstPrisma = new PrismaService();
    secondPrisma = new PrismaService();
    observerPrisma = new PrismaService();
    await Promise.all([firstPrisma.$connect(), secondPrisma.$connect(), observerPrisma.$connect()]);
  });

  afterAll(async () => {
    await Promise.all([
      firstPrisma?.$disconnect(),
      secondPrisma?.$disconnect(),
      observerPrisma?.$disconnect(),
    ]);
  });

  beforeEach(async () => {
    await firstPrisma.cleanDatabase();
    const employee = await firstPrisma.employee.create({
      data: {
        serialNumber: 'PAYROLL-E2E-USER',
        name: '薪资并发 E2E',
      },
    });
    currentUser = { id: employee.id, employeeId: employee.id };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function createContendedClients() {
    const firstLocked = createDeferred();
    const releaseFirst = createDeferred();
    const secondDispatched = createDeferred();
    let secondBackendPid: number | undefined;

    return {
      firstClient: withLockHooks(firstPrisma, {
        afterAcquire: async () => {
          firstLocked.resolve();
          await releaseFirst.promise;
        },
      }),
      secondClient: withLockHooks(secondPrisma, {
        afterDispatch: (backendPid) => {
          secondBackendPid = backendPid;
          secondDispatched.resolve();
        },
      }),
      firstLocked: firstLocked.promise,
      rejectFirst: firstLocked.reject,
      rejectSecond: secondDispatched.reject,
      async verifySecondWaitingAndRelease() {
        try {
          await secondDispatched.promise;
          expect(secondBackendPid).toBeTypeOf('number');
          await expectAdvisoryLockWait(observerPrisma, secondBackendPid!);
        } finally {
          releaseFirst.resolve();
        }
      },
    };
  }

  async function runTwoCommitsWithControlledLockOrder() {
    const firstLocked = createDeferred();
    const releaseFirst = createDeferred();
    const secondDispatched = createDeferred();
    let secondBackendPid: number | undefined;

    const firstService = new PayrollImportService(
      withLockHooks(firstPrisma, {
        afterAcquire: async () => {
          firstLocked.resolve();
          await releaseFirst.promise;
        },
      }),
      {} as never
    );
    const secondService = new PayrollImportService(
      withLockHooks(secondPrisma, {
        afterDispatch: (backendPid) => {
          secondBackendPid = backendPid;
          secondDispatched.resolve();
        },
      }),
      {} as never
    );
    stubParsedWorkbook(firstService, parsedWorkbook('first.xlsx', '第一批员工'));
    stubParsedWorkbook(secondService, parsedWorkbook('second.xlsx', '第二批员工'));

    const firstCommit = firstService
      .commitImport('file:///workspace/admin/uploads/first.xlsx', 'replace_period', currentUser)
      .catch((error: unknown) => {
        firstLocked.reject(error);
        throw error;
      });
    await firstLocked.promise;

    const secondCommit = secondService
      .commitImport('file:///workspace/admin/uploads/second.xlsx', 'replace_period', currentUser)
      .catch((error: unknown) => {
        secondDispatched.reject(error);
        throw error;
      });
    // 在第一事务仍持锁时，从第三连接证明第二个 service 的真实 SQL 已进入 advisory wait。
    try {
      await secondDispatched.promise;
      expect(secondBackendPid).toBeTypeOf('number');
      await expectAdvisoryLockWait(observerPrisma, secondBackendPid!);
    } finally {
      releaseFirst.resolve();
    }
    return Promise.all([firstCommit, secondCommit]);
  }

  async function expectOnlySecondBatchActive(secondBatchId: string, expectedVersion: number) {
    const period = await firstPrisma.payrollPeriod.findUniqueOrThrow({
      where: { periodKey: '2026-04' },
    });
    expect(period.version).toBe(expectedVersion);
    expect(period.rowCount).toBe(1);
    expect(period.sourceFileName).toBe('second.xlsx');
    expect(period.importBatchId).toBe(secondBatchId);

    const records = await firstPrisma.payrollRecord.findMany({
      where: { payrollPeriodId: period.id },
      orderBy: { createdAt: 'asc' },
    });
    expect(records.filter(({ deletedAt }) => deletedAt === null)).toEqual([
      expect.objectContaining({
        employeeNameSnapshot: '第二批员工',
        importBatchId: secondBatchId,
      }),
    ]);
    expect(
      await firstPrisma.payrollRecord.count({
        where: { payrollPeriodId: period.id, deletedAt: null },
      })
    ).toBe(period.rowCount);
    return records;
  }

  it('serializes two service commits when the period does not exist yet', async () => {
    const [, secondResult] = await runTwoCommitsWithControlledLockOrder();

    const records = await expectOnlySecondBatchActive((secondResult.batch as { id: string }).id, 2);
    expect(records).toHaveLength(2);
    expect(
      records.find(({ employeeNameSnapshot }) => employeeNameSnapshot === '第一批员工')
    ).toEqual(expect.objectContaining({ deletedAt: expect.any(Date) }));
    expect(await firstPrisma.payrollImportBatch.count()).toBe(2);
  });

  it('serializes two service commits when an existing period is replaced', async () => {
    const period = await firstPrisma.payrollPeriod.create({
      data: {
        periodKey: '2026-04',
        year: 2026,
        month: 4,
        sourceFileName: 'seed.xlsx',
        rowCount: 1,
      },
    });
    await firstPrisma.payrollRecord.create({
      data: {
        payrollPeriodId: period.id,
        employeeNameSnapshot: '种子员工',
      },
    });

    const [, secondResult] = await runTwoCommitsWithControlledLockOrder();

    const records = await expectOnlySecondBatchActive((secondResult.batch as { id: string }).id, 3);
    expect(records).toHaveLength(3);
    expect(records.filter(({ deletedAt }) => deletedAt !== null)).toHaveLength(2);
    expect(await firstPrisma.payrollImportBatch.count()).toBe(2);
  });

  it('serializes import → CRUD create and keeps period rowCount/version consistent', async () => {
    const contention = createContendedClients();
    const importService = new PayrollImportService(contention.firstClient, {} as never);
    const payrollService = new PayrollService(contention.secondClient);
    stubParsedWorkbook(importService, parsedWorkbook('import-first.xlsx', '导入员工'));

    const importCommit = importService
      .commitImport(
        'file:///workspace/admin/uploads/import-first.xlsx',
        'replace_period',
        currentUser
      )
      .catch((error: unknown) => {
        contention.rejectFirst(error);
        throw error;
      });
    await contention.firstLocked;

    const crudCreate = payrollService
      .create(
        {
          periodKey: '2026-04',
          employeeNameSnapshot: '手工新增员工',
        },
        currentUser
      )
      .catch((error: unknown) => {
        contention.rejectSecond(error);
        throw error;
      });
    await contention.verifySecondWaitingAndRelease();
    await Promise.all([importCommit, crudCreate]);

    const period = await firstPrisma.payrollPeriod.findUniqueOrThrow({
      where: { periodKey: '2026-04' },
    });
    expect(period.rowCount).toBe(2);
    expect(period.version).toBe(2);
    expect(
      await firstPrisma.payrollRecord.findMany({
        where: { payrollPeriodId: period.id, deletedAt: null },
        select: { employeeNameSnapshot: true },
        orderBy: { employeeNameSnapshot: 'asc' },
      })
    ).toEqual([{ employeeNameSnapshot: '导入员工' }, { employeeNameSnapshot: '手工新增员工' }]);
  });

  it('serializes CRUD create → import replacement and leaves only the imported row active', async () => {
    const contention = createContendedClients();
    const payrollService = new PayrollService(contention.firstClient);
    const importService = new PayrollImportService(contention.secondClient, {} as never);
    stubParsedWorkbook(importService, parsedWorkbook('import-second.xlsx', '替换后员工'));

    const crudCreate = payrollService
      .create(
        {
          periodKey: '2026-04',
          employeeNameSnapshot: '即将被替换员工',
        },
        currentUser
      )
      .catch((error: unknown) => {
        contention.rejectFirst(error);
        throw error;
      });
    await contention.firstLocked;

    const importCommit = importService
      .commitImport(
        'file:///workspace/admin/uploads/import-second.xlsx',
        'replace_period',
        currentUser
      )
      .catch((error: unknown) => {
        contention.rejectSecond(error);
        throw error;
      });
    await contention.verifySecondWaitingAndRelease();
    await Promise.all([crudCreate, importCommit]);

    const period = await firstPrisma.payrollPeriod.findUniqueOrThrow({
      where: { periodKey: '2026-04' },
    });
    expect(period.rowCount).toBe(1);
    expect(period.version).toBe(3);
    const records = await firstPrisma.payrollRecord.findMany({
      where: { payrollPeriodId: period.id },
      orderBy: { createdAt: 'asc' },
    });
    expect(records).toHaveLength(2);
    expect(records[0]).toEqual(
      expect.objectContaining({
        employeeNameSnapshot: '即将被替换员工',
        deletedAt: expect.any(Date),
      })
    );
    expect(records[1]).toEqual(
      expect.objectContaining({ employeeNameSnapshot: '替换后员工', deletedAt: null })
    );
  });

  it('rejects a stale batch delete atomically without changing rows or period metadata', async () => {
    const period = await firstPrisma.payrollPeriod.create({
      data: { periodKey: '2026-04', year: 2026, month: 4, rowCount: 2 },
    });
    const firstRecord = await firstPrisma.payrollRecord.create({
      data: { payrollPeriodId: period.id, employeeNameSnapshot: '批删员工一' },
    });
    const secondRecord = await firstPrisma.payrollRecord.create({
      data: { payrollPeriodId: period.id, employeeNameSnapshot: '批删员工二' },
    });
    await firstPrisma.payrollRecord.update({
      where: { id: secondRecord.id },
      data: { version: { increment: 1 } },
    });

    const payrollService = new PayrollService(firstPrisma);
    await expect(
      payrollService.batchRemove(
        [firstRecord.id, secondRecord.id],
        { [firstRecord.id]: 1, [secondRecord.id]: 1 },
        currentUser
      )
    ).rejects.toBeInstanceOf(ConflictException);

    expect(
      await firstPrisma.payrollRecord.findMany({
        where: { id: { in: [firstRecord.id, secondRecord.id] } },
        select: { id: true, version: true, deletedAt: true },
        orderBy: { id: 'asc' },
      })
    ).toEqual(
      expect.arrayContaining([
        { id: firstRecord.id, version: 1, deletedAt: null },
        { id: secondRecord.id, version: 2, deletedAt: null },
      ])
    );
    expect(await firstPrisma.payrollPeriod.findUniqueOrThrow({ where: { id: period.id } })).toEqual(
      expect.objectContaining({ rowCount: 2, version: 1 })
    );
  });

  it('rolls back soft delete, period CAS, rowCount, and import batch when insert fails', async () => {
    const period = await firstPrisma.payrollPeriod.create({
      data: {
        periodKey: '2026-04',
        year: 2026,
        month: 4,
        sourceFileName: 'before.xlsx',
        rowCount: 1,
      },
    });
    await firstPrisma.payrollRecord.create({
      data: {
        payrollPeriodId: period.id,
        employeeNameSnapshot: '回滚前员工',
      },
    });

    const service = new PayrollImportService(firstPrisma, {} as never);
    stubParsedWorkbook(service, parsedWorkbook('rollback.xlsx', '超'.repeat(101)));

    await expect(
      service.commitImport(
        'file:///workspace/admin/uploads/rollback.xlsx',
        'replace_period',
        currentUser
      )
    ).rejects.toThrow();

    const persistedPeriod = await firstPrisma.payrollPeriod.findUniqueOrThrow({
      where: { periodKey: '2026-04' },
    });
    expect(persistedPeriod.version).toBe(1);
    expect(persistedPeriod.rowCount).toBe(1);
    expect(persistedPeriod.sourceFileName).toBe('before.xlsx');
    expect(
      await firstPrisma.payrollRecord.count({
        where: { payrollPeriodId: period.id, deletedAt: null },
      })
    ).toBe(1);
    expect(await firstPrisma.payrollImportBatch.count()).toBe(0);
  });
});
