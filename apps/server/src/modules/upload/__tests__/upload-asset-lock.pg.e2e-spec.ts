import type { Prisma } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { PrismaService } from '../../../common/prisma/prisma.service';
import { lockUploadAsset } from '../upload-asset-lock.helper';

type Deferred = {
  promise: Promise<void>;
  resolve: () => void;
  reject: (error: unknown) => void;
};

function deferred(): Deferred {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<void>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timeout: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

async function expectAdvisoryWait(observer: PrismaService, backendPid: number): Promise<void> {
  const deadline = Date.now() + 3_000;
  while (Date.now() < deadline) {
    // @prisma-raw-sql: Upload PG E2E observes only the contender backend wait state.
    const [activity] = await observer.$queryRaw<
      Array<{ waitEventType: string | null; waitEvent: string | null; query: string }>
    >`
      SELECT
        wait_event_type AS "waitEventType",
        wait_event AS "waitEvent",
        query
      FROM pg_stat_activity
      WHERE pid = ${backendPid}
    `;
    if (activity?.waitEventType === 'Lock' && activity.waitEvent === 'advisory') {
      expect(activity.query).toContain('pg_advisory_xact_lock');
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Upload compensation backend ${backendPid} did not enter advisory wait`);
}

const describeUploadPg = process.env.RUN_UPLOAD_PG_E2E === '1' ? describe : describe.skip;

describeUploadPg('Upload FileAsset advisory-lock PostgreSQL E2E', () => {
  let setupPrisma: PrismaService;
  let creatorPrisma: PrismaService;
  let compensationPrisma: PrismaService;
  let observerPrisma: PrismaService;
  let ownerEmployeeId: string;

  beforeAll(async () => {
    setupPrisma = new PrismaService();
    creatorPrisma = new PrismaService();
    compensationPrisma = new PrismaService();
    observerPrisma = new PrismaService();
    await Promise.all(
      [setupPrisma, creatorPrisma, compensationPrisma, observerPrisma].map((client) =>
        client.$connect()
      )
    );
  });

  afterAll(async () => {
    await Promise.all(
      [setupPrisma, creatorPrisma, compensationPrisma, observerPrisma]
        .filter(Boolean)
        .map((client) => client.$disconnect())
    );
  });

  beforeEach(async () => {
    await setupPrisma.cleanDatabase();
    const employee = await setupPrisma.employee.create({
      data: {
        serialNumber: 'E2E-UPLOAD-ASSET-LOCK-OWNER',
        name: 'Upload advisory lock owner',
      },
    });
    ownerEmployeeId = employee.id;
  });

  it('T2 barrier waits for T1 commit, then a fresh Serializable transaction removes the row', async () => {
    const identity = {
      id: '00000000-0000-4000-8000-000000000024',
      storageKey: '20991231/upload-lock-contract.png',
    };
    const creatorInserted = deferred();
    const releaseCreator = deferred();
    const creatorDone = creatorPrisma
      .$transaction(
        async (transaction: Prisma.TransactionClient) => {
          await lockUploadAsset(transaction, identity);
          await transaction.fileAsset.create({
            data: {
              ...identity,
              originalName: 'upload-lock-contract.png',
              size: 1,
              mimeType: 'image/png',
              ownerEmployeeId,
            },
          });
          creatorInserted.resolve();
          await releaseCreator.promise;
        },
        { isolationLevel: 'Serializable', timeout: 10_000 }
      )
      .catch((error: unknown) => {
        creatorInserted.reject(error);
        throw error;
      });
    void creatorDone.catch(() => undefined);

    await withTimeout(creatorInserted.promise, 3_000, 'T1 did not acquire lock and stage row');

    let contenderBackendPid: number | undefined;
    const barrierDispatched = deferred();
    const barrier = compensationPrisma.$transaction(
      async (transaction: Prisma.TransactionClient) => {
        // @prisma-raw-sql: Record the exact transaction connection before dispatching its lock.
        const [session] = await transaction.$queryRaw<
          Array<{ pid: number }>
        >`SELECT pg_backend_pid() AS pid`;
        contenderBackendPid = session?.pid;
        if (!contenderBackendPid) throw new Error('Unable to read compensation backend pid');
        barrierDispatched.resolve();
        await lockUploadAsset(transaction, identity);
      },
      { isolationLevel: 'Serializable', timeout: 10_000 }
    );
    void barrier.catch((error: unknown) => barrierDispatched.reject(error));

    try {
      await withTimeout(barrierDispatched.promise, 3_000, 'T2 did not dispatch advisory lock');
      if (!contenderBackendPid) throw new Error('T2 backend pid is unavailable');
      await expectAdvisoryWait(observerPrisma, contenderBackendPid);
    } finally {
      releaseCreator.resolve();
    }

    await creatorDone;
    await barrier;

    const result = await compensationPrisma.$transaction(
      async (transaction: Prisma.TransactionClient) => {
        await lockUploadAsset(transaction, identity);
        const matched = await transaction.fileAsset.findMany({
          where: {
            id: identity.id,
            storageKey: identity.storageKey,
            ownerEmployeeId,
          },
          select: { id: true },
        });
        const deletion = await transaction.fileAsset.deleteMany({
          where: {
            id: identity.id,
            storageKey: identity.storageKey,
            ownerEmployeeId,
          },
        });
        const remaining = await transaction.fileAsset.count({
          where: {
            OR: [{ id: identity.id }, { storageKey: identity.storageKey }],
          },
        });
        return { matched: matched.length, deleted: deletion.count, remaining };
      },
      { isolationLevel: 'Serializable' }
    );

    expect(result).toEqual({ matched: 1, deleted: 1, remaining: 0 });
    expect(
      await setupPrisma.fileAsset.count({
        where: { OR: [{ id: identity.id }, { storageKey: identity.storageKey }] },
      })
    ).toBe(0);
  });
});
