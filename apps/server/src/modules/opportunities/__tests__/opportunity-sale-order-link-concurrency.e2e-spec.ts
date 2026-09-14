import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { FilterApplierService } from '../../../common/filter-scheme';
import { PrismaService } from '../../../common/prisma/prisma.service';
import type { SerialNumberService } from '../../../common/services/serial-number.service';
import { toJsonValue } from '../../../common/utils/json-type-helpers';
import { ApprovalChangeRequestsService } from '../../approvals/approval-change-requests.service';
import type { CustomersService } from '../../customers/customers.service';
import { PaymentsService } from '../../payments/payments.service';
import { buildSaleOrderVoidPlan } from '../../sale-orders/sale-order-void-plan.helper';
import { SaleOrdersService } from '../../sale-orders/sale-orders.service';
import { OpportunitiesService } from '../opportunities.service';

const LOCK_OBSERVATION_TIMEOUT_MS = 3_000;
const LOCK_POLL_INTERVAL_MS = 10;
const TEST_TRANSACTION_TIMEOUT_MS = 10_000;

type Deferred = {
  promise: Promise<void>;
  resolve: () => void;
  reject: (error: unknown) => void;
};

type StartedContender<T> = {
  operation: Promise<T>;
  dispatched: Promise<void>;
  backendPid: () => number;
};

type HeldSaleOrderCreation = {
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

function withTimeout<T>(promise: Promise<T>, milliseconds: number, message: string): Promise<T> {
  return new Promise<T>((resolvePromise, rejectPromise) => {
    const timer = setTimeout(() => rejectPromise(new Error(message)), milliseconds);
    void promise.then(
      (value) => {
        clearTimeout(timer);
        resolvePromise(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        rejectPromise(error);
      }
    );
  });
}

function waitForBarrierOrOperation<T>(
  barrier: Promise<void>,
  operation: Promise<T>,
  milliseconds: number,
  message: string
): Promise<void> {
  const operationSettledBeforeBarrier = operation.then(() => {
    throw new Error(`${message}：操作在屏障前已完成`);
  });
  return withTimeout(Promise.race([barrier, operationSettledBeforeBarrier]), milliseconds, message);
}

async function releaseAndSettle(release: Deferred, operations: Promise<unknown>[]): Promise<void> {
  release.resolve();
  await Promise.allSettled(operations);
}

function rawSqlParts(args: unknown[]): { text: string; values: unknown[] } {
  const [query] = args;
  if (Array.isArray(query)) {
    return { text: query.join('?'), values: args.slice(1) };
  }
  if (!query || typeof query !== 'object') return { text: '', values: [] };
  const text = 'sql' in query && typeof query.sql === 'string' ? query.sql : '';
  const values = 'values' in query && Array.isArray(query.values) ? query.values : [];
  return { text, values };
}

/**
 * 只拦截 contender interactive transaction 中目标 sale_order_opportunity advisory lock；
 * 在请求发往 PostgreSQL 后记录该专属 transaction connection 的 backend pid。
 */
function withOpportunityLockHooks(
  prisma: PrismaService,
  opportunityId: string,
  afterDispatch: (backendPid: number) => void
): PrismaService {
  const advisoryKey = `sale_order_opportunity:${opportunityId}`;

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
                  // @prisma-raw-sql: 测试代理原样转发参数化 raw SQL，只观测目标 advisory lock 的发送时刻。
                  const executeRaw = transactionTarget.$executeRaw as unknown as (
                    ...rawArgs: unknown[]
                  ) => Promise<number>;
                  const { text, values } = rawSqlParts(args);
                  if (!text.includes('pg_advisory_xact_lock') || !values.includes(advisoryKey)) {
                    return Reflect.apply(executeRaw, transactionTarget, args) as Promise<number>;
                  }

                  // @prisma-raw-sql: 在 contender 的同一 transaction connection 上取得 pid，再发送会阻塞的目标锁请求。
                  const [session] = await transactionTarget.$queryRaw<Array<{ pid: number }>>(
                    Prisma.sql`SELECT pg_backend_pid() AS pid`
                  );
                  const backendPid = session?.pid;
                  if (!backendPid) throw new Error('无法读取 contender PostgreSQL backend pid');

                  const lockRequest = Promise.resolve(
                    Reflect.apply(executeRaw, transactionTarget, args) as Promise<number>
                  );
                  afterDispatch(backendPid);
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

function withAcquiredOpportunityLockPause(
  prisma: PrismaService,
  opportunityId: string,
  afterAcquired: (backendPid: number) => Promise<void>
): PrismaService {
  const advisoryKey = `sale_order_opportunity:${opportunityId}`;

  return new Proxy(prisma, {
    get(target, property) {
      if (property !== '$transaction') return Reflect.get(target, property, target);

      return <T>(callback: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> =>
        target.$transaction(
          async (tx) => {
            const pausedTx = new Proxy(tx, {
              get(transactionTarget, transactionProperty) {
                if (transactionProperty !== '$executeRaw') {
                  return Reflect.get(transactionTarget, transactionProperty, transactionTarget);
                }

                return async (...args: unknown[]): Promise<number> => {
                  // @prisma-raw-sql: 测试代理原样转发参数化 advisory-lock SQL，并在真实取锁后建立屏障。
                  const executeRaw = transactionTarget.$executeRaw as unknown as (
                    ...rawArgs: unknown[]
                  ) => Promise<number>;
                  const { text, values } = rawSqlParts(args);
                  if (!text.includes('pg_advisory_xact_lock') || !values.includes(advisoryKey)) {
                    return Reflect.apply(executeRaw, transactionTarget, args) as Promise<number>;
                  }

                  // @prisma-raw-sql: 测试屏障在同一 transaction connection 取得 pid，并仅在真实 advisory lock 获得后暂停。
                  const [session] = await transactionTarget.$queryRaw<Array<{ pid: number }>>(
                    Prisma.sql`SELECT pg_backend_pid() AS pid`
                  );
                  const backendPid = session?.pid;
                  if (!backendPid) throw new Error('无法读取 holder PostgreSQL backend pid');
                  const result = await (Reflect.apply(
                    executeRaw,
                    transactionTarget,
                    args
                  ) as Promise<number>);
                  await afterAcquired(backendPid);
                  return result;
                };
              },
            });
            return callback(pausedTx);
          },
          { timeout: TEST_TRANSACTION_TIMEOUT_MS }
        );
    },
  });
}

function startContender<T>(
  prisma: PrismaService,
  opportunityId: string,
  run: (client: PrismaService) => Promise<T>
): StartedContender<T> {
  const dispatched = createDeferred();
  let capturedBackendPid: number | undefined;
  const hookedClient = withOpportunityLockHooks(prisma, opportunityId, (backendPid) => {
    capturedBackendPid = backendPid;
    dispatched.resolve();
  });

  const operation = Promise.resolve()
    .then(() => run(hookedClient))
    .catch((error: unknown) => {
      dispatched.reject(error);
      throw error;
    });
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

function withDelegateWritePause(
  prisma: PrismaService,
  delegateName: 'payment' | 'saleOrder',
  methodName: 'update',
  afterWrite: (backendPid: number) => Promise<void>
): PrismaService {
  return new Proxy(prisma, {
    get(target, property) {
      if (property !== '$transaction') return Reflect.get(target, property, target);
      return <T>(callback: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> =>
        target.$transaction(
          async (tx) => {
            const hookedTx = new Proxy(tx, {
              get(transactionTarget, transactionProperty) {
                if (transactionProperty !== delegateName) {
                  return Reflect.get(transactionTarget, transactionProperty, transactionTarget);
                }
                const delegate = Reflect.get(
                  transactionTarget,
                  transactionProperty,
                  transactionTarget
                ) as object;
                return new Proxy(delegate, {
                  get(delegateTarget, method) {
                    if (method !== methodName) {
                      return Reflect.get(delegateTarget, method, delegateTarget);
                    }
                    return async (...args: unknown[]) => {
                      // @prisma-raw-sql: 在目标生产写语句及其 statement trigger 返回后暂停，并记录同一 transaction pid。
                      const [session] = await transactionTarget.$queryRaw<Array<{ pid: number }>>(
                        Prisma.sql`SELECT pg_backend_pid() AS pid`
                      );
                      const backendPid = session?.pid;
                      if (!backendPid) throw new Error('无法读取 relationship holder backend pid');
                      const write = Reflect.get(delegateTarget, method, delegateTarget) as (
                        ...writeArgs: unknown[]
                      ) => Promise<unknown>;
                      const result = await Reflect.apply(write, delegateTarget, args);
                      await afterWrite(backendPid);
                      return result;
                    };
                  },
                });
              },
            });
            return callback(hookedTx);
          },
          { timeout: TEST_TRANSACTION_TIMEOUT_MS }
        );
    },
  });
}

function withPaymentCreatePause(
  prisma: PrismaService,
  afterCreated: (backendPid: number) => Promise<void>
): PrismaService {
  return new Proxy(prisma, {
    get(target, property) {
      if (property !== '$transaction') return Reflect.get(target, property, target);
      return <T>(callback: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> =>
        target.$transaction(
          async (tx) => {
            const hookedTx = new Proxy(tx, {
              get(transactionTarget, transactionProperty) {
                if (transactionProperty !== 'payment') {
                  return Reflect.get(transactionTarget, transactionProperty, transactionTarget);
                }
                const delegate = transactionTarget.payment;
                return new Proxy(delegate, {
                  get(delegateTarget, method) {
                    if (method !== 'create')
                      return Reflect.get(delegateTarget, method, delegateTarget);
                    return async (...args: unknown[]) => {
                      // @prisma-raw-sql: 在 Payment INSERT 的 Customer trigger 返回后暂停同一 transaction，并记录其 backend pid。
                      const [session] = await transactionTarget.$queryRaw<Array<{ pid: number }>>(
                        Prisma.sql`SELECT pg_backend_pid() AS pid`
                      );
                      const backendPid = session?.pid;
                      if (!backendPid) throw new Error('无法读取 Payment holder backend pid');
                      const create = delegateTarget.create as unknown as (
                        ...createArgs: unknown[]
                      ) => Promise<unknown>;
                      const result = await Reflect.apply(create, delegateTarget, args);
                      await afterCreated(backendPid);
                      return result;
                    };
                  },
                });
              },
            });
            return callback(hookedTx);
          },
          { timeout: TEST_TRANSACTION_TIMEOUT_MS }
        );
    },
  });
}

async function observeBlockedBy(
  observerPrisma: PrismaService,
  blockerPid: number,
  waiterPid: number
): Promise<void> {
  const deadline = Date.now() + LOCK_OBSERVATION_TIMEOUT_MS;
  while (Date.now() < deadline) {
    // @prisma-raw-sql: pg_blocking_pids 是真实锁等待屏障，不用 sleep 猜测并发时序。
    const rows = await observerPrisma.$queryRaw<Array<{ blockers: number[] }>>(Prisma.sql`
      SELECT pg_catalog.pg_blocking_pids(${waiterPid}::int) AS blockers
    `);
    if (rows[0]?.blockers.includes(blockerPid)) return;
    await new Promise<void>((resolvePromise) => setTimeout(resolvePromise, LOCK_POLL_INTERVAL_MS));
  }
  throw new Error(`未观测到 waiter=${waiterPid} 被 blocker=${blockerPid} 阻塞`);
}

async function observeTargetAdvisoryLockWait(
  observerPrisma: PrismaService,
  holderBackendPid: number,
  contenderBackendPid: number
): Promise<void> {
  await observerPrisma.$transaction(
    async (observerTx) => {
      // @prisma-raw-sql: observer 固定在第三条独立 transaction connection，并验证连接互不复用。
      const [observerSession] = await observerTx.$queryRaw<Array<{ pid: number }>>(
        Prisma.sql`SELECT pg_backend_pid() AS pid`
      );
      const observerBackendPid = observerSession?.pid;
      if (!observerBackendPid) throw new Error('无法读取 observer PostgreSQL backend pid');
      expect(new Set([holderBackendPid, contenderBackendPid, observerBackendPid]).size).toBe(3);

      const deadline = Date.now() + LOCK_OBSERVATION_TIMEOUT_MS;
      let lastObservation: AdvisoryWaitObservation[] = [];
      while (Date.now() < deadline) {
        // @prisma-raw-sql: 联查 pg_locks/pg_stat_activity；只有同一 advisory lock 上 holder granted 且 contender waiting 才通过屏障。
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
          WHERE waiter.pid = ${contenderBackendPid}
            AND waiter.locktype = 'advisory'
            AND waiter.mode = 'ExclusiveLock'
            AND waiter.granted = false
            AND holder.pid = ${holderBackendPid}
            AND holder.granted = true
        `);

        const observation = lastObservation[0];
        if (observation) {
          expect(observation).toMatchObject({
            waiterPid: contenderBackendPid,
            holderPid: holderBackendPid,
            waiterGranted: false,
            holderGranted: true,
            mode: 'ExclusiveLock',
            state: 'active',
            waitEventType: 'Lock',
            waitEvent: 'advisory',
          });
          expect(observation.query).toContain('pg_advisory_xact_lock');
          return;
        }

        // 轮询只让出查询间隔；同步条件来自 pg_locks/pg_stat_activity，而非假定 sleep 后已阻塞。
        await new Promise<void>((resolvePromise) =>
          setTimeout(resolvePromise, LOCK_POLL_INTERVAL_MS)
        );
      }

      throw new Error(
        `contender 未进入目标 advisory lock 等待态：holder=${holderBackendPid}, contender=${contenderBackendPid}, observed=${JSON.stringify(lastObservation)}`
      );
    },
    { timeout: TEST_TRANSACTION_TIMEOUT_MS }
  );
}

describe('Opportunity 与 SaleOrder 关联并发不变量 PG E2E', () => {
  let setupPrisma: PrismaService;
  let holderPrisma: PrismaService;
  let observerPrisma: PrismaService;
  let contenderPrisma: PrismaService;
  let employeeId: string;
  let oldCustomerId: string;
  let newCustomerId: string;
  let opportunityId: string;
  let opportunityVersion: number;
  let holderSequence = 0;
  let serviceSerialSequence = 0;

  const saleOrderProducts = [
    {
      productName: '并发测试产品',
      quantity: 1,
      unitPrice: 100,
      contractUnitPrice: 90,
    },
  ];

  function opportunitiesService(prisma: PrismaService): OpportunitiesService {
    return new OpportunitiesService(
      prisma,
      {} as SerialNumberService,
      {
        refreshCustomerLifecycle: () => Promise.resolve(),
      } as unknown as CustomersService,
      {} as FilterApplierService
    );
  }

  function saleOrdersService(prisma: PrismaService): SaleOrdersService {
    return new SaleOrdersService(
      prisma,
      {
        generate: async () => `E2E-SO-SVC-${holderSequence}-${++serviceSerialSequence}`,
      } as unknown as ConstructorParameters<typeof SaleOrdersService>[1],
      {
        isRequired: async () => true,
      } as unknown as ConstructorParameters<typeof SaleOrdersService>[2],
      {
        notifyOnSubmit: async () => undefined,
      } as unknown as ConstructorParameters<typeof SaleOrdersService>[3],
      {
        createApprovalForNewRecord: async () => 'e2e-noop-approval',
        assertCanDirectEdit: () => undefined,
        lockPendingFormEdit: async () => null,
        syncPendingFormEdit: async () => undefined,
        assertCanDelete: () => undefined,
      } as unknown as ConstructorParameters<typeof SaleOrdersService>[4],
      {
        buildWhere: async ({ baseWhere }: { baseWhere: unknown }) => baseWhere,
      } as unknown as ConstructorParameters<typeof SaleOrdersService>[5]
    );
  }

  function paymentsService(prisma: PrismaService): PaymentsService {
    return new PaymentsService(
      prisma,
      {
        generate: async () => `E2E-PAY-SVC-${holderSequence}-${++serviceSerialSequence}`,
      } as unknown as ConstructorParameters<typeof PaymentsService>[1],
      {
        isRequired: async () => false,
      } as unknown as ConstructorParameters<typeof PaymentsService>[2],
      {
        notifyOnSubmit: async () => undefined,
      } as unknown as ConstructorParameters<typeof PaymentsService>[3],
      {} as ConstructorParameters<typeof PaymentsService>[4],
      {} as ConstructorParameters<typeof PaymentsService>[5],
      {} as ConstructorParameters<typeof PaymentsService>[6],
      {
        syncFromPayment: async () => undefined,
      } as unknown as ConstructorParameters<typeof PaymentsService>[7],
      {
        recalculateForPayment: async () => ({ updated: 0 }),
      } as unknown as ConstructorParameters<typeof PaymentsService>[8]
    );
  }

  function approvalChangeRequestsService(prisma: PrismaService): ApprovalChangeRequestsService {
    return new ApprovalChangeRequestsService(
      prisma,
      {
        syncFromPayment: async () => undefined,
        revokeFromPayment: async () => undefined,
      } as unknown as ConstructorParameters<typeof ApprovalChangeRequestsService>[1],
      {
        recalculateForPayment: async () => ({ updated: 0 }),
        recalculateBatch: async () => ({ updated: 0 }),
      } as unknown as ConstructorParameters<typeof ApprovalChangeRequestsService>[2]
    );
  }

  beforeAll(async () => {
    setupPrisma = new PrismaService();
    holderPrisma = new PrismaService();
    observerPrisma = new PrismaService();
    contenderPrisma = new PrismaService();
    await Promise.all(
      [setupPrisma, holderPrisma, observerPrisma, contenderPrisma].map((client) =>
        client.$connect()
      )
    );
  });

  afterAll(async () => {
    await Promise.all(
      [setupPrisma, holderPrisma, observerPrisma, contenderPrisma]
        .filter(Boolean)
        .map((client) => client.$disconnect())
    );
  });

  beforeEach(async () => {
    await setupPrisma.cleanDatabase();
    holderSequence += 1;

    const employee = await setupPrisma.employee.create({
      data: {
        serialNumber: `E2E-OPP-SO-EMP-${holderSequence}`,
        name: '商机订单并发测试员工',
      },
    });
    employeeId = employee.id;

    const [oldCustomer, newCustomer] = await Promise.all([
      setupPrisma.customer.create({
        data: {
          serialNumber: `E2E-OPP-SO-CUSTOMER-A-${holderSequence}`,
          customerName: '并发原客户',
        },
      }),
      setupPrisma.customer.create({
        data: {
          serialNumber: `E2E-OPP-SO-CUSTOMER-B-${holderSequence}`,
          customerName: '并发新客户',
        },
      }),
    ]);
    oldCustomerId = oldCustomer.id;
    newCustomerId = newCustomer.id;

    const opportunity = await setupPrisma.opportunity.create({
      data: {
        serialNumber: `E2E-OPP-SO-OPP-${holderSequence}`,
        opportunityName: '并发关联商机',
        customerId: oldCustomerId,
        chargerId: employeeId,
      },
    });
    opportunityId = opportunity.id;
    opportunityVersion = opportunity.version;
  });

  async function holdSaleOrderCreation(): Promise<HeldSaleOrderCreation> {
    const acquired = createDeferred();
    const releaseBarrier = createDeferred();
    let holderBackendPid: number | undefined;
    const pausedPrisma = withAcquiredOpportunityLockPause(
      holderPrisma,
      opportunityId,
      async (backendPid) => {
        holderBackendPid = backendPid;
        acquired.resolve();
        await releaseBarrier.promise;
      }
    );

    // 必须走生产 SaleOrdersService.create；屏障仅暂停真实 advisory lock 返回，不手工拼 tx.create。
    const done = saleOrdersService(pausedPrisma)
      .create(
        {
          customerId: oldCustomerId,
          opportunityId,
          chargerId: employeeId,
          orderAmount: 90,
          products: saleOrderProducts,
        } as Parameters<SaleOrdersService['create']>[0],
        { id: employeeId, employeeId },
        null,
        employeeId
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
        'holder 未在期限内通过生产 create 获取 sale_order_opportunity advisory lock'
      );
    } catch (error) {
      releaseBarrier.resolve();
      await done.catch(() => undefined);
      throw error;
    }

    if (!holderBackendPid) throw new Error('holder 尚未记录 PostgreSQL backend pid');
    return {
      backendPid: holderBackendPid,
      release: releaseBarrier.resolve,
      done,
    };
  }

  async function runWhileSaleOrderCreationHeld<T>(
    run: (client: PrismaService) => Promise<T>
  ): Promise<PromiseSettledResult<T>> {
    const heldCreation = await holdSaleOrderCreation();
    const contender = startContender(contenderPrisma, opportunityId, run);
    let barrierFailure: unknown;

    try {
      await withTimeout(
        contender.dispatched,
        LOCK_OBSERVATION_TIMEOUT_MS,
        'contender 未在期限内把 advisory-lock 请求发送到 PostgreSQL'
      );
      await observeTargetAdvisoryLockWait(
        observerPrisma,
        heldCreation.backendPid,
        contender.backendPid()
      );
    } catch (error) {
      barrierFailure = error;
    } finally {
      heldCreation.release();
      try {
        await heldCreation.done;
      } catch (error) {
        barrierFailure ??= error;
      }
    }

    const [result] = await Promise.allSettled([contender.operation]);
    if (barrierFailure) throw barrierFailure;
    if (!result) throw new Error('contender 未返回结果');
    return result;
  }

  async function runWhileOpportunityRebindHeld<T>(
    run: (client: PrismaService) => Promise<T>
  ): Promise<PromiseSettledResult<T>> {
    const acquired = createDeferred();
    const releaseBarrier = createDeferred();
    let holderBackendPid: number | undefined;
    const pausedPrisma = withAcquiredOpportunityLockPause(
      holderPrisma,
      opportunityId,
      async (backendPid) => {
        holderBackendPid = backendPid;
        acquired.resolve();
        await releaseBarrier.promise;
      }
    );
    const holder = opportunitiesService(pausedPrisma)
      .update(
        opportunityId,
        {
          customerId: newCustomerId,
          version: opportunityVersion,
        } as Parameters<OpportunitiesService['update']>[1],
        { id: employeeId, employeeId }
      )
      .then(() => undefined);
    void holder.catch(() => undefined);

    await withTimeout(
      acquired.promise,
      LOCK_OBSERVATION_TIMEOUT_MS,
      'Opportunity holder 未在期限内取得关联 advisory lock'
    );
    if (!holderBackendPid) throw new Error('Opportunity holder 尚未记录 backend pid');

    const contender = startContender(contenderPrisma, opportunityId, run);
    let barrierFailure: unknown;
    try {
      await withTimeout(
        contender.dispatched,
        LOCK_OBSERVATION_TIMEOUT_MS,
        'SaleOrder contender 未发送关联 advisory-lock 请求'
      );
      await observeTargetAdvisoryLockWait(observerPrisma, holderBackendPid, contender.backendPid());
    } catch (error) {
      barrierFailure = error;
    } finally {
      releaseBarrier.resolve();
      try {
        await holder;
      } catch (error) {
        barrierFailure ??= error;
      }
    }

    const [result] = await Promise.allSettled([contender.operation]);
    if (barrierFailure) throw barrierFailure;
    if (!result) throw new Error('SaleOrder contender 未返回结果');
    return result;
  }

  it('并发建单持锁时改绑等待；订单提交后改绑复查并返回 409', async () => {
    const result = await runWhileSaleOrderCreationHeld((client) =>
      opportunitiesService(client).update(
        opportunityId,
        {
          customerId: newCustomerId,
          version: opportunityVersion,
        } as Parameters<OpportunitiesService['update']>[1],
        { id: employeeId, employeeId }
      )
    );

    expect(result.status).toBe('rejected');
    if (result.status !== 'rejected') throw new Error('改绑本应被有效订单拒绝');
    expect(result.reason).toBeInstanceOf(ConflictException);

    const stored = await setupPrisma.opportunity.findUniqueOrThrow({
      where: { id: opportunityId },
      select: { customerId: true, deletedAt: true, version: true },
    });
    expect(stored).toEqual({
      customerId: oldCustomerId,
      deletedAt: null,
      version: opportunityVersion,
    });
    expect(
      await setupPrisma.saleOrder.count({
        where: { opportunityId, deletedAt: null },
      })
    ).toBe(1);
  });

  it('并发建单持锁时软删等待；订单提交后软删复查并返回 409', async () => {
    const result = await runWhileSaleOrderCreationHeld((client) =>
      opportunitiesService(client).remove(
        opportunityId,
        { id: employeeId, employeeId },
        undefined,
        undefined,
        opportunityVersion
      )
    );

    expect(result.status).toBe('rejected');
    if (result.status !== 'rejected') throw new Error('软删本应被有效订单拒绝');
    expect(result.reason).toBeInstanceOf(ConflictException);

    const stored = await setupPrisma.opportunity.findUniqueOrThrow({
      where: { id: opportunityId },
      select: { customerId: true, deletedAt: true, version: true },
    });
    expect(stored).toEqual({
      customerId: oldCustomerId,
      deletedAt: null,
      version: opportunityVersion,
    });
    expect(
      await setupPrisma.saleOrder.count({
        where: { opportunityId, deletedAt: null },
      })
    ).toBe(1);
  });

  it('Opportunity 改绑先提交后，生产 create 锁后重查拒绝旧客户快照', async () => {
    const result = await runWhileOpportunityRebindHeld((client) =>
      saleOrdersService(client).create(
        {
          customerId: oldCustomerId,
          opportunityId,
          chargerId: employeeId,
          orderAmount: 90,
          products: saleOrderProducts,
        } as Parameters<SaleOrdersService['create']>[0],
        { id: employeeId, employeeId },
        null,
        employeeId
      )
    );

    expect(result.status).toBe('rejected');
    if (result.status !== 'rejected') throw new Error('旧客户 create 本应在锁后复查失败');
    expect(result.reason).toBeInstanceOf(BadRequestException);
    expect(await setupPrisma.saleOrder.count({ where: { opportunityId } })).toBe(0);
    expect(
      await setupPrisma.opportunity.findUniqueOrThrow({
        where: { id: opportunityId },
        select: { customerId: true },
      })
    ).toEqual({ customerId: newCustomerId });
  });

  it('void bundle 生产落地先锁 SaleOrder/Opportunity，再触碰 Payment Customer，无 C→O 反向边', async () => {
    const order = await saleOrdersService(setupPrisma).create(
      {
        customerId: oldCustomerId,
        opportunityId,
        chargerId: employeeId,
        orderAmount: 100,
        products: saleOrderProducts,
      } as Parameters<SaleOrdersService['create']>[0],
      { id: employeeId, employeeId },
      null,
      employeeId
    );
    if (order.version == null) throw new Error('生产 create 未返回 SaleOrder version');
    await setupPrisma.saleOrder.update({
      where: { id: order.id },
      data: { flowStatus: 'approved' },
    });
    const voidApproverRole = await setupPrisma.role.create({
      data: {
        code: `e2e-void-approver-${holderSequence}`,
        name: 'E2E 订单作废审批人',
      },
    });
    await setupPrisma.userRole.create({
      data: { employeeId, roleId: voidApproverRole.id },
    });
    await setupPrisma.rolePermission.create({
      data: {
        roleId: voidApproverRole.id,
        module: 'crm',
        menu: 'sale_orders',
        delete: true,
        viewScope: 'ALL',
      },
    });
    await setupPrisma.payment.create({
      data: {
        serialNumber: `E2E-VOID-PAY-${holderSequence}`,
        subject: '待清理草稿回款',
        saleOrderId: order.id,
        customerId: oldCustomerId,
        paymentAmount: '1',
        direction: 'IN',
        flowStatus: 'draft',
        chargerId: employeeId,
      },
    });
    const voidPlan = await buildSaleOrderVoidPlan(setupPrisma, order.id);
    expect(voidPlan.preview.blockers).toEqual([]);
    const change = await setupPrisma.approvalChangeRequest.create({
      data: {
        eventType: 'sale_order_void',
        targetType: 'sale_order',
        targetId: order.id,
        targetCode: order.serialNumber,
        title: 'E2E 纠错作废',
        baseVersion: order.version,
        patch: toJsonValue({
          __operation: 'void_bundle',
          __reason: '并发锁序验证',
          dependencySnapshot: voidPlan.snapshot,
          projectAction: voidPlan.preview.requiresProjectAction ? 'rollback_to_opportunity' : null,
        })!,
        beforeSnapshot: {},
        afterSnapshot: {},
        status: 'pending',
        creatorEmployeeId: employeeId,
      },
    });

    const childTouchedCustomer = createDeferred();
    const releaseVoid = createDeferred();
    let voidBackendPid: number | undefined;
    const pausedVoidPrisma = withDelegateWritePause(
      holderPrisma,
      'payment',
      'update',
      async (backendPid) => {
        voidBackendPid = backendPid;
        childTouchedCustomer.resolve();
        await releaseVoid.promise;
      }
    );
    const voidOperation = pausedVoidPrisma.$transaction((tx) =>
      approvalChangeRequestsService(pausedVoidPrisma).handleApprovalResult(
        tx,
        'sale_order_void',
        change.id,
        order.version,
        'approved',
        { id: employeeId, employeeId }
      )
    );
    void voidOperation.catch(() => undefined);
    let opportunityContender: StartedContender<unknown> | undefined;
    try {
      await waitForBarrierOrOperation(
        childTouchedCustomer.promise,
        voidOperation,
        LOCK_OBSERVATION_TIMEOUT_MS,
        'void bundle 未到达首个 Payment Customer touch'
      );
      if (!voidBackendPid) throw new Error('void holder 未记录 backend pid');

      opportunityContender = startContender(contenderPrisma, opportunityId, (client) =>
        opportunitiesService(client).update(
          opportunityId,
          {
            remark: '等待 void 预锁的 Opportunity',
            version: opportunityVersion,
          } as Parameters<OpportunitiesService['update']>[1],
          { id: employeeId, employeeId }
        )
      );
      await withTimeout(
        opportunityContender.dispatched,
        LOCK_OBSERVATION_TIMEOUT_MS,
        'Opportunity 关系 advisory lock 未发送'
      );
      const opportunityBackendPid = opportunityContender.backendPid();
      if (!opportunityBackendPid) throw new Error('Opportunity waiter 未记录 backend pid');
      await observeTargetAdvisoryLockWait(observerPrisma, voidBackendPid, opportunityBackendPid);
    } catch (error: unknown) {
      await releaseAndSettle(releaseVoid, [
        voidOperation,
        ...(opportunityContender ? [opportunityContender.operation] : []),
      ]);
      throw error;
    }
    if (!opportunityContender) throw new Error('Opportunity contender 未启动');

    releaseVoid.resolve();
    const [voidResult, opportunityResult] = await Promise.allSettled([
      withTimeout(voidOperation, TEST_TRANSACTION_TIMEOUT_MS, 'void bundle 未完成'),
      withTimeout(
        opportunityContender.operation,
        TEST_TRANSACTION_TIMEOUT_MS,
        'Opportunity UPDATE 未完成'
      ),
    ]);
    if (voidResult.status === 'rejected') throw voidResult.reason;
    if (opportunityResult.status === 'rejected') throw opportunityResult.reason;
    expect(
      await setupPrisma.saleOrder.findUniqueOrThrow({
        where: { id: order.id },
        select: { deletedAt: true },
      })
    ).toEqual({ deletedAt: expect.any(Date) });
  });

  it('生产 remove 先锁 SaleOrder/Opportunity 后再软删触碰 Customer，无 S→O / C→O 反向边', async () => {
    const order = await saleOrdersService(setupPrisma).create(
      {
        customerId: oldCustomerId,
        opportunityId,
        chargerId: employeeId,
        orderAmount: 100,
        products: saleOrderProducts,
      } as Parameters<SaleOrdersService['create']>[0],
      { id: employeeId, employeeId },
      null,
      employeeId
    );
    const relationWriteCompleted = createDeferred();
    const releaseRemove = createDeferred();
    let removeBackendPid: number | undefined;
    const pausedRemovePrisma = withDelegateWritePause(
      holderPrisma,
      'saleOrder',
      'update',
      async (backendPid) => {
        removeBackendPid = backendPid;
        relationWriteCompleted.resolve();
        await releaseRemove.promise;
      }
    );
    const removeOperation = saleOrdersService(pausedRemovePrisma).remove(
      order.id,
      { id: employeeId, employeeId },
      null,
      employeeId,
      order.version
    );
    void removeOperation.catch(() => undefined);
    let opportunityContender: StartedContender<unknown> | undefined;
    try {
      await waitForBarrierOrOperation(
        relationWriteCompleted.promise,
        removeOperation,
        LOCK_OBSERVATION_TIMEOUT_MS,
        'remove 未完成关系性 SaleOrder UPDATE'
      );
      if (!removeBackendPid) throw new Error('remove holder 未记录 backend pid');

      opportunityContender = startContender(contenderPrisma, opportunityId, (client) =>
        opportunitiesService(client).update(
          opportunityId,
          {
            remark: '等待 remove 预锁的 Opportunity',
            version: opportunityVersion,
          } as Parameters<OpportunitiesService['update']>[1],
          { id: employeeId, employeeId }
        )
      );
      await withTimeout(
        opportunityContender.dispatched,
        LOCK_OBSERVATION_TIMEOUT_MS,
        'Opportunity 关系 advisory lock 未发送'
      );
      const opportunityBackendPid = opportunityContender.backendPid();
      if (!opportunityBackendPid) throw new Error('Opportunity waiter 未记录 backend pid');
      await observeTargetAdvisoryLockWait(observerPrisma, removeBackendPid, opportunityBackendPid);
    } catch (error: unknown) {
      await releaseAndSettle(releaseRemove, [
        removeOperation,
        ...(opportunityContender ? [opportunityContender.operation] : []),
      ]);
      throw error;
    }
    if (!opportunityContender) throw new Error('Opportunity contender 未启动');

    releaseRemove.resolve();
    const [removeResult, opportunityResult] = await Promise.allSettled([
      withTimeout(removeOperation, TEST_TRANSACTION_TIMEOUT_MS, 'remove 未完成'),
      withTimeout(
        opportunityContender.operation,
        TEST_TRANSACTION_TIMEOUT_MS,
        'Opportunity UPDATE 未完成'
      ),
    ]);
    expect(removeResult.status).toBe('fulfilled');
    expect(opportunityResult.status).toBe('fulfilled');
  });

  it('Payment INSERT 已持 Customer 时，生产 summary 普通 UPDATE 不再等待 Opportunity，双方无 40P01', async () => {
    const order = await saleOrdersService(setupPrisma).create(
      {
        customerId: oldCustomerId,
        opportunityId,
        chargerId: employeeId,
        orderAmount: 100,
        products: saleOrderProducts,
      } as Parameters<SaleOrdersService['create']>[0],
      { id: employeeId, employeeId },
      null,
      employeeId
    );
    await setupPrisma.saleOrder.update({
      where: { id: order.id },
      data: { flowStatus: 'approved' },
    });
    const orderProduct = await setupPrisma.orderProduct.findFirstOrThrow({
      where: { saleOrderId: order.id, deletedAt: null },
      select: { id: true },
    });
    const paymentCreated = createDeferred();
    const releasePayment = createDeferred();
    let paymentBackendPid: number | undefined;
    const pausedPaymentPrisma = withPaymentCreatePause(holderPrisma, async (backendPid) => {
      paymentBackendPid = backendPid;
      paymentCreated.resolve();
      await releasePayment.promise;
    });
    const paymentOperation = paymentsService(pausedPaymentPrisma).create(
      {
        saleOrderId: order.id,
        customerId: oldCustomerId,
        chargerId: employeeId,
        paymentAmount: 10,
        subject: '并发回款',
        items: [
          {
            saleOrderProductId: orderProduct.id,
            amount: 10,
            paymentMode: 'direct',
          },
        ],
      } as Parameters<PaymentsService['create']>[0],
      { id: employeeId, employeeId },
      null,
      employeeId
    );
    void paymentOperation.catch(() => undefined);
    let opportunityContender: StartedContender<unknown> | undefined;
    try {
      await waitForBarrierOrOperation(
        paymentCreated.promise,
        paymentOperation,
        LOCK_OBSERVATION_TIMEOUT_MS,
        'Payment 未完成 INSERT'
      );
      if (!paymentBackendPid) throw new Error('Payment holder 未记录 backend pid');

      opportunityContender = startContender(contenderPrisma, opportunityId, (client) =>
        opportunitiesService(client).update(
          opportunityId,
          {
            remark: '等待 SaleOrder/Customer 图锁',
            version: opportunityVersion,
          } as Parameters<OpportunitiesService['update']>[1],
          { id: employeeId, employeeId }
        )
      );
      await withTimeout(
        opportunityContender.dispatched,
        LOCK_OBSERVATION_TIMEOUT_MS,
        'Opportunity 关系 advisory lock 未发送'
      );
      const opportunityBackendPid = opportunityContender.backendPid();
      if (!opportunityBackendPid) throw new Error('Opportunity waiter 未记录 backend pid');
      await observeBlockedBy(observerPrisma, paymentBackendPid, opportunityBackendPid);
    } catch (error: unknown) {
      await releaseAndSettle(releasePayment, [
        paymentOperation,
        ...(opportunityContender ? [opportunityContender.operation] : []),
      ]);
      throw error;
    }
    if (!opportunityContender) throw new Error('Opportunity contender 未启动');

    releasePayment.resolve();
    const [paymentResult, opportunityResult] = await Promise.allSettled([
      withTimeout(paymentOperation, TEST_TRANSACTION_TIMEOUT_MS, 'Payment 事务未完成'),
      withTimeout(
        opportunityContender.operation,
        TEST_TRANSACTION_TIMEOUT_MS,
        'Opportunity 事务未完成'
      ),
    ]);
    expect(paymentResult.status).toBe('fulfilled');
    expect(opportunityResult.status).toBe('fulfilled');
  });

  it('Opportunity 改绑先提交后，生产 SaleOrder rebind 锁后重查拒绝旧客户快照', async () => {
    const sourceOrder = await saleOrdersService(setupPrisma).create(
      {
        customerId: oldCustomerId,
        chargerId: employeeId,
        orderAmount: 90,
        products: saleOrderProducts,
      } as Parameters<SaleOrdersService['create']>[0],
      { id: employeeId, employeeId },
      null,
      employeeId
    );

    const result = await runWhileOpportunityRebindHeld((client) =>
      saleOrdersService(client).update(
        sourceOrder.id,
        { opportunityId, version: sourceOrder.version } as Parameters<
          SaleOrdersService['update']
        >[1],
        { id: employeeId, employeeId },
        null,
        employeeId
      )
    );

    expect(result.status).toBe('rejected');
    if (result.status !== 'rejected') throw new Error('旧客户 rebind 本应在锁后复查失败');
    expect(result.reason).toBeInstanceOf(ForbiddenException);
    expect(
      await setupPrisma.saleOrder.findUniqueOrThrow({
        where: { id: sourceOrder.id },
        select: { opportunityId: true, version: true },
      })
    ).toEqual({ opportunityId: null, version: sourceOrder.version });
  });
});
