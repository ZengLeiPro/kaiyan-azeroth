import { Prisma } from '@prisma/client';

import type { FilterApplierService } from '../../../common/filter-scheme';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { EmployeePermissionCacheService } from '../../../common/services/employee-permission-cache.service';
import type { SerialNumberService } from '../../../common/services/serial-number.service';
import { EmployeesService } from '../../employees/employees.service';
import { SessionsService } from '../../sessions/sessions.service';
import { UsersService } from '../../users/users.service';
import { DepartmentsService } from '../departments.service';
import { lockEmployeeDepartmentWrites } from '../employee-department-lock';

const LOCK_OBSERVATION_TIMEOUT_MS = 3_000;
const LOCK_POLL_INTERVAL_MS = 10;
const TEST_TRANSACTION_TIMEOUT_MS = 10_000;

type Deferred = {
  promise: Promise<void>;
  resolve: () => void;
  reject: (error: unknown) => void;
};

type LockAttemptHooks = {
  afterDispatch: (backendPid: number) => void | Promise<void>;
};

type StartedContender<T> = {
  operation: Promise<T>;
  dispatched: Promise<void>;
  backendPid: () => number;
};

type HeldEmployeeDepartmentLock = {
  backendPid: number;
  release: () => void;
  done: Promise<void>;
};

type AdvisoryWaitObservation = {
  waiterPid: number;
  holderPid: number;
  waiterGranted: boolean;
  holderGranted: boolean;
  mode: string;
  state: string;
  waitEventType: string | null;
  waitEvent: string | null;
  query: string;
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

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function withTimeout<T>(promise: Promise<T>, milliseconds: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), milliseconds);
    void promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

function rawSqlText(args: unknown[]): string {
  const [query] = args;
  if (Array.isArray(query)) return query.join('?');
  if (query && typeof query === 'object' && 'sql' in query) {
    const sql = (query as { sql?: unknown }).sql;
    if (typeof sql === 'string') return sql;
  }
  return '';
}

/**
 * 包装一个专属 PrismaService 的 interactive transaction，只在目标 advisory-lock SQL
 * 发往 PostgreSQL 时记录该 transaction connection 的 backend pid；其余 Prisma 调用原样转发。
 */
function withEmployeeDepartmentLockHooks(
  prisma: PrismaService,
  hooks: LockAttemptHooks
): PrismaService {
  return new Proxy(prisma, {
    get(target, property) {
      if (property !== '$transaction') return Reflect.get(target, property, target);

      return <T>(callback: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> =>
        target.$transaction(
          async (tx) => {
            const hookedTx = new Proxy(tx, {
              get(transactionTarget, transactionProperty) {
                if (transactionProperty !== '$executeRaw') {
                  return Reflect.get(transactionTarget, transactionProperty, transactionTarget);
                }

                return async (...args: unknown[]): Promise<number> => {
                  // @prisma-raw-sql: 代理专属 transaction connection 的原始执行函数，以便只观测并转发目标 advisory-lock 请求。
                  const executeRaw = transactionTarget.$executeRaw as unknown as (
                    ...rawArgs: unknown[]
                  ) => Promise<number>;
                  if (!rawSqlText(args).includes('pg_advisory_xact_lock')) {
                    return Reflect.apply(executeRaw, transactionTarget, args) as Promise<number>;
                  }

                  // @prisma-raw-sql: 在同一真实 transaction connection 上读取 contender pid，再原样发送目标 advisory-lock SQL。
                  const [session] = await transactionTarget.$queryRaw<Array<{ pid: number }>>(
                    Prisma.sql`SELECT pg_backend_pid() AS pid`
                  );
                  const backendPid = session?.pid;
                  if (!backendPid) throw new Error('无法读取 contender PostgreSQL backend pid');

                  const lockRequest = Promise.resolve(
                    Reflect.apply(executeRaw, transactionTarget, args) as Promise<number>
                  );
                  await hooks.afterDispatch(backendPid);
                  return lockRequest;
                };
              },
            });
            return callback(hookedTx);
          },
          { timeout: TEST_TRANSACTION_TIMEOUT_MS }
        );
    },
  });
}

function startContender<T>(
  prisma: PrismaService,
  run: (client: PrismaService) => Promise<T>
): StartedContender<T> {
  const dispatched = createDeferred();
  let capturedBackendPid: number | undefined;
  const hookedClient = withEmployeeDepartmentLockHooks(prisma, {
    afterDispatch: (backendPid) => {
      capturedBackendPid = backendPid;
      dispatched.resolve();
    },
  });

  const operation = Promise.resolve()
    .then(() => run(hookedClient))
    .catch((error: unknown) => {
      dispatched.reject(error);
      throw error;
    });
  // 先挂 rejection handler，观察 barrier 失败时也不会留下暂时未处理的 contender rejection。
  void operation.catch(() => undefined);

  return {
    operation,
    dispatched: dispatched.promise,
    backendPid: () => {
      if (!capturedBackendPid) throw new Error('contender 尚未记录 PostgreSQL backend pid');
      return capturedBackendPid;
    },
  };
}

async function observeTargetAdvisoryLockWait(
  observerPrisma: PrismaService,
  holderBackendPid: number,
  contenderBackendPids: number[]
): Promise<number> {
  return observerPrisma.$transaction(
    async (observerTx) => {
      // @prisma-raw-sql: 将 observer 固定在独立 transaction connection，并记录其 backend pid。
      const [observerSession] = await observerTx.$queryRaw<Array<{ pid: number }>>(
        Prisma.sql`SELECT pg_backend_pid() AS pid`
      );
      const observerBackendPid = observerSession?.pid;
      if (!observerBackendPid) throw new Error('无法读取 observer PostgreSQL backend pid');

      expect(new Set([holderBackendPid, observerBackendPid, ...contenderBackendPids]).size).toBe(
        2 + contenderBackendPids.length
      );

      const deadline = Date.now() + LOCK_OBSERVATION_TIMEOUT_MS;
      let lastObservation: AdvisoryWaitObservation[] = [];
      while (Date.now() < deadline) {
        // @prisma-raw-sql: 从独立 observer 连接联查 pg_locks/pg_stat_activity；同一 lock tag 上 holder 已获锁且 contender 未获锁，才证明目标 advisory lock 正在等待。
        lastObservation = await observerTx.$queryRaw<AdvisoryWaitObservation[]>(Prisma.sql`
          SELECT
            waiter.pid AS "waiterPid",
            holder.pid AS "holderPid",
            waiter.granted AS "waiterGranted",
            holder.granted AS "holderGranted",
            waiter.mode,
            activity.state,
            activity.wait_event_type AS "waitEventType",
            activity.wait_event AS "waitEvent",
            activity.query
          FROM pg_catalog.pg_locks AS waiter
          INNER JOIN pg_catalog.pg_locks AS holder
            ON holder.locktype = waiter.locktype
            AND holder.database IS NOT DISTINCT FROM waiter.database
            AND holder.classid IS NOT DISTINCT FROM waiter.classid
            AND holder.objid IS NOT DISTINCT FROM waiter.objid
            AND holder.objsubid IS NOT DISTINCT FROM waiter.objsubid
            AND holder.mode = waiter.mode
          INNER JOIN pg_catalog.pg_stat_activity AS activity
            ON activity.pid = waiter.pid
          WHERE waiter.pid IN (${Prisma.join(contenderBackendPids)})
            AND waiter.locktype = 'advisory'
            AND waiter.mode = 'ExclusiveLock'
            AND waiter.granted = false
            AND holder.pid = ${holderBackendPid}
            AND holder.granted = true
        `);

        const observationByPid = new Map(
          lastObservation.map((observation) => [observation.waiterPid, observation])
        );
        if (contenderBackendPids.every((backendPid) => observationByPid.has(backendPid))) {
          for (const backendPid of contenderBackendPids) {
            const observation = observationByPid.get(backendPid);
            expect(observation).toMatchObject({
              waiterPid: backendPid,
              holderPid: holderBackendPid,
              waiterGranted: false,
              holderGranted: true,
              mode: 'ExclusiveLock',
              state: 'active',
              waitEventType: 'Lock',
              waitEvent: 'advisory',
            });
            expect(observation?.query).toContain('pg_advisory_xact_lock');
          }
          return observerBackendPid;
        }
        await delay(LOCK_POLL_INTERVAL_MS);
      }

      throw new Error(
        `contender 未在期限内进入目标 advisory lock 等待态：holder=${holderBackendPid}, contenders=${contenderBackendPids.join(',')}, observed=${JSON.stringify(lastObservation)}`
      );
    },
    { timeout: TEST_TRANSACTION_TIMEOUT_MS }
  );
}

describe('员工主部门应用事务与并发 E2E', () => {
  let setupPrisma: PrismaService;
  let lockHolderPrisma: PrismaService;
  let lockObserverPrisma: PrismaService;
  let contenderPrismas: [PrismaService, PrismaService, PrismaService];
  let employeeId: string;
  let employeeVersion: number;
  let departmentIds: [string, string, string];

  function departmentsService(prisma: PrismaService): DepartmentsService {
    return new DepartmentsService(prisma, {} as FilterApplierService);
  }

  function employeesService(prisma: PrismaService): EmployeesService {
    return new EmployeesService(
      prisma,
      {} as SerialNumberService,
      {} as FilterApplierService,
      new EmployeePermissionCacheService()
    );
  }

  function usersService(prisma: PrismaService): UsersService {
    return new UsersService(
      prisma,
      new SessionsService(prisma),
      new EmployeePermissionCacheService()
    );
  }

  beforeAll(async () => {
    setupPrisma = new PrismaService();
    lockHolderPrisma = new PrismaService();
    lockObserverPrisma = new PrismaService();
    contenderPrismas = [new PrismaService(), new PrismaService(), new PrismaService()];
    await Promise.all(
      [setupPrisma, lockHolderPrisma, lockObserverPrisma, ...contenderPrismas].map((client) =>
        client.$connect()
      )
    );
  });

  afterAll(async () => {
    await Promise.all(
      [setupPrisma, lockHolderPrisma, lockObserverPrisma, ...contenderPrismas]
        .filter(Boolean)
        .map((client) => client.$disconnect())
    );
  });

  beforeEach(async () => {
    await setupPrisma.cleanDatabase();
    const employee = await setupPrisma.employee.create({
      data: {
        serialNumber: 'E2E-PRIMARY-DEPT-EMPLOYEE',
        name: '主部门约束测试员工',
      },
    });
    employeeId = employee.id;
    employeeVersion = employee.version;

    const departments = await Promise.all(
      Array.from({ length: 3 }, (_, index) =>
        setupPrisma.department.create({ data: { name: `主部门约束测试部门 ${index + 1}` } })
      )
    );
    const [first, second, third] = departments;
    if (!first || !second || !third) {
      throw new Error('测试部门初始化失败');
    }
    departmentIds = [first.id, second.id, third.id];
  });

  async function holdEmployeeDepartmentLock(): Promise<HeldEmployeeDepartmentLock> {
    const acquired = createDeferred();
    const releaseBarrier = createDeferred();
    let holderBackendPid: number | undefined;

    const done = lockHolderPrisma
      .$transaction(
        async (tx) => {
          // @prisma-raw-sql: 在专属 holder transaction connection 上记录 pid，再获取同一员工的真实 advisory lock。
          const [session] = await tx.$queryRaw<Array<{ pid: number }>>(
            Prisma.sql`SELECT pg_backend_pid() AS pid`
          );
          holderBackendPid = session?.pid;
          if (!holderBackendPid) throw new Error('无法读取 holder PostgreSQL backend pid');

          await lockEmployeeDepartmentWrites(tx, employeeId);
          acquired.resolve();
          await releaseBarrier.promise;
        },
        { timeout: TEST_TRANSACTION_TIMEOUT_MS }
      )
      .then(() => undefined)
      .catch((error: unknown) => {
        acquired.reject(error);
        throw error;
      });
    void done.catch(() => undefined);

    try {
      await withTimeout(
        acquired.promise,
        LOCK_OBSERVATION_TIMEOUT_MS,
        'holder 未在期限内获取 employee department advisory lock'
      );
    } catch (error) {
      releaseBarrier.resolve();
      await done.catch(() => undefined);
      throw error;
    }

    if (!holderBackendPid) throw new Error('holder 尚未记录 PostgreSQL backend pid');
    return { backendPid: holderBackendPid, release: releaseBarrier.resolve, done };
  }

  async function runContendersWhileLockHeld(
    start: () => StartedContender<unknown>[]
  ): Promise<PromiseSettledResult<unknown>[]> {
    const heldLock = await holdEmployeeDepartmentLock();
    let contenders: StartedContender<unknown>[] = [];
    let failure: unknown;
    let failed = false;

    try {
      contenders = start();
      await withTimeout(
        Promise.all(contenders.map(({ dispatched }) => dispatched)).then(() => undefined),
        LOCK_OBSERVATION_TIMEOUT_MS,
        'contender 未在期限内把 advisory-lock 请求发送到 PostgreSQL'
      );
      const contenderBackendPids = contenders.map(({ backendPid }) => backendPid());
      await observeTargetAdvisoryLockWait(
        lockObserverPrisma,
        heldLock.backendPid,
        contenderBackendPids
      );
    } catch (error) {
      failed = true;
      failure = error;
    } finally {
      // 无论 dispatch、锁观测或断言在哪一步失败，都先释放 holder barrier，禁止遗留悬挂事务/连接。
      heldLock.release();
      try {
        await heldLock.done;
      } catch (error) {
        if (!failed) {
          failed = true;
          failure = error;
        }
      }
    }

    const results = await Promise.allSettled(contenders.map(({ operation }) => operation));
    if (failed) throw failure;
    return results;
  }

  it('创建新主部门失败时回滚旧主部门清除', async () => {
    await setupPrisma.employeeDepartment.create({
      data: {
        employeeId,
        departmentId: departmentIds[0],
        isPrimary: true,
      },
    });

    await expect(
      departmentsService(setupPrisma).addEmployee(departmentIds[1], employeeId, true, {
        id: 'missing-creator',
        employeeId: 'missing-creator',
      })
    ).rejects.toMatchObject({ code: 'P2003' });

    const oldPrimary = await setupPrisma.employeeDepartment.findUniqueOrThrow({
      where: {
        employeeId_departmentId: {
          employeeId,
          departmentId: departmentIds[0],
        },
      },
    });
    expect(oldPrimary.isPrimary).toBe(true);
    expect(await setupPrisma.employeeDepartment.count({ where: { employeeId } })).toBe(1);
  });

  it('独立 contender 连接在目标锁上等待，释放后 add/add 串行且仅一个主部门', async () => {
    const results = await runContendersWhileLockHeld(() => [
      startContender(contenderPrismas[0], (client) =>
        departmentsService(client).addEmployee(departmentIds[0], employeeId, false)
      ),
      startContender(contenderPrismas[1], (client) =>
        departmentsService(client).addEmployee(departmentIds[1], employeeId, true)
      ),
    ]);

    expect(results.every((result) => result.status === 'fulfilled')).toBe(true);
    expect(await setupPrisma.employeeDepartment.count({ where: { employeeId } })).toBe(2);
    expect(
      await setupPrisma.employeeDepartment.count({ where: { employeeId, isPrimary: true } })
    ).toBe(1);
  });

  it('独立 contender 连接在目标锁上等待，释放后 sync/add/remove 保持主部门不变量', async () => {
    await setupPrisma.employeeDepartment.create({
      data: {
        employeeId,
        departmentId: departmentIds[0],
        isPrimary: true,
        sortOrder: 0,
      },
    });

    const results = await runContendersWhileLockHeld(() => [
      startContender(contenderPrismas[0], (client) =>
        employeesService(client).update(
          employeeId,
          {
            departmentIds: [departmentIds[0], departmentIds[1]],
            primaryDepartmentId: departmentIds[1],
            version: employeeVersion,
          },
          { id: employeeId, employeeId }
        )
      ),
      startContender(contenderPrismas[1], (client) =>
        departmentsService(client).addEmployee(departmentIds[2], employeeId, false)
      ),
      startContender(contenderPrismas[2], (client) =>
        departmentsService(client).removeEmployee(departmentIds[0], employeeId)
      ),
    ]);

    expect(results.every((result) => result.status === 'fulfilled')).toBe(true);
    expect(await setupPrisma.employeeDepartment.count({ where: { employeeId } })).toBeGreaterThan(
      0
    );
    expect(
      await setupPrisma.employeeDepartment.count({ where: { employeeId, isPrimary: true } })
    ).toBe(1);
  });

  it('员工删除与部门移除先竞争同一 advisory lock，释放后均可完成', async () => {
    await setupPrisma.employeeDepartment.create({
      data: {
        employeeId,
        departmentId: departmentIds[0],
        isPrimary: true,
        sortOrder: 0,
      },
    });

    const results = await runContendersWhileLockHeld(() => [
      startContender(contenderPrismas[0], (client) =>
        employeesService(client).remove(employeeId, { id: employeeId, employeeId })
      ),
      startContender(contenderPrismas[1], (client) =>
        departmentsService(client).removeEmployee(departmentIds[0], employeeId)
      ),
    ]);

    expect(results.every((result) => result.status === 'fulfilled')).toBe(true);
    expect(
      await setupPrisma.employee.findUniqueOrThrow({
        where: { id: employeeId },
        select: { deletedAt: true },
      })
    ).toEqual({ deletedAt: expect.any(Date) });
    expect(await setupPrisma.employeeDepartment.count({ where: { employeeId } })).toBe(0);
  });

  it('用户删除入口与部门移除也先竞争同一 advisory lock，释放后均可完成', async () => {
    await setupPrisma.employeeDepartment.create({
      data: {
        employeeId,
        departmentId: departmentIds[0],
        isPrimary: true,
        sortOrder: 0,
      },
    });

    const results = await runContendersWhileLockHeld(() => [
      startContender(contenderPrismas[0], (client) =>
        usersService(client).remove(employeeId, { id: employeeId, employeeId })
      ),
      startContender(contenderPrismas[1], (client) =>
        departmentsService(client).removeEmployee(departmentIds[0], employeeId)
      ),
    ]);

    expect(results.every((result) => result.status === 'fulfilled')).toBe(true);
    expect(
      await setupPrisma.employee.findUniqueOrThrow({
        where: { id: employeeId },
        select: { deletedAt: true },
      })
    ).toEqual({ deletedAt: expect.any(Date) });
    expect(await setupPrisma.employeeDepartment.count({ where: { employeeId } })).toBe(0);
  });
});
