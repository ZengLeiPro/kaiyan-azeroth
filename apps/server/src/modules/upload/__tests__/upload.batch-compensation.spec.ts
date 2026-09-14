import { InternalServerErrorException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import * as fsp from 'fs/promises';
import { tmpdir } from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { UploadService } from '../upload.service';

vi.mock('fs/promises', async () => {
  const actual = await vi.importActual<typeof import('fs/promises')>('fs/promises');
  return { ...actual, unlink: vi.fn((target: string) => actual.unlink(target)) };
});

vi.mock('crypto', async () => {
  const actual = await vi.importActual<typeof import('crypto')>('crypto');
  return { ...actual, randomBytes: vi.fn(), randomUUID: vi.fn() };
});

interface StoredAsset {
  id: string;
  ownerEmployeeId: string;
  storageKey: string;
  originalName: string;
}

interface AssetIdentity {
  id: string;
  ownerEmployeeId: string;
  storageKey: string;
}

interface ExactWhere {
  OR: AssetIdentity[];
}

interface ConflictWhere {
  OR: [{ id: { in: string[] } }, { storageKey: { in: string[] } }];
}

type AssetWhere = ExactWhere | ConflictWhere;

interface CreateArgs {
  data: StoredAsset & { size: number; mimeType: string };
  select: { id: true };
}

function buildFile(originalname: string, content = originalname) {
  const buffer = Buffer.from(content);
  return { originalname, buffer, size: buffer.length, mimetype: 'image/png' };
}

function createDeferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function matchesWhere(asset: StoredAsset, where: AssetWhere): boolean {
  const conditions = where.OR as Array<
    AssetIdentity | { id: { in: string[] } } | { storageKey: { in: string[] } }
  >;
  return conditions.some((condition) => {
    if ('ownerEmployeeId' in condition) {
      return (
        condition.id === asset.id &&
        condition.ownerEmployeeId === asset.ownerEmployeeId &&
        condition.storageKey === asset.storageKey
      );
    }
    if ('id' in condition) return condition.id.in.includes(asset.id);
    return condition.storageKey.in.includes(asset.storageKey);
  });
}

function createPrismaHarness() {
  const rows: StoredAsset[] = [];
  const fileAsset = {
    create: vi.fn(async ({ data }: CreateArgs) => {
      rows.push({
        id: data.id,
        ownerEmployeeId: data.ownerEmployeeId,
        storageKey: data.storageKey,
        originalName: data.originalName,
      });
      return { id: data.id };
    }),
    findMany: vi.fn(async ({ where }: { where: ExactWhere }) =>
      rows
        .filter((asset) => matchesWhere(asset, where))
        .map(({ id, ownerEmployeeId, storageKey }) => ({ id, ownerEmployeeId, storageKey }))
    ),
    count: vi.fn(
      async ({ where }: { where: AssetWhere }) =>
        rows.filter((asset) => matchesWhere(asset, where)).length
    ),
    deleteMany: vi.fn(async ({ where }: { where: ExactWhere }) => {
      const before = rows.length;
      const retained = rows.filter((asset) => !matchesWhere(asset, where));
      rows.splice(0, rows.length, ...retained);
      return { count: before - retained.length };
    }),
  };
  const executeRaw = vi.fn().mockResolvedValue(1);
  const prisma = {
    fileAsset,
    $executeRaw: executeRaw,
    $transaction: vi.fn(
      async (
        callback: (transaction: {
          fileAsset: typeof fileAsset;
          $executeRaw: typeof executeRaw;
        }) => Promise<unknown>,
        _options?: { isolationLevel?: string }
      ) => {
        const snapshot = rows.map((row) => ({ ...row }));
        let compensationReadStarted = false;
        const transactionFileAsset = {
          create: (...args: Parameters<typeof fileAsset.create>) => fileAsset.create(...args),
          findMany: (...args: Parameters<typeof fileAsset.findMany>) => {
            compensationReadStarted = true;
            return fileAsset.findMany(...args);
          },
          count: (...args: Parameters<typeof fileAsset.count>) => {
            compensationReadStarted = true;
            return fileAsset.count(...args);
          },
          deleteMany: (...args: Parameters<typeof fileAsset.deleteMany>) => {
            compensationReadStarted = true;
            return fileAsset.deleteMany(...args);
          },
        };
        try {
          return await callback({
            fileAsset: transactionFileAsset as typeof fileAsset,
            $executeRaw: executeRaw,
          });
        } catch (error) {
          // Creation failures may represent an already-committed transaction whose
          // client Promise rejected. Compensation failures, in contrast, must roll
          // back every delete performed by their interactive transaction.
          if (compensationReadStarted) rows.splice(0, rows.length, ...snapshot);
          throw error;
        }
      }
    ),
  };
  return { prisma, rows, executeRaw };
}

// The implementation is Linux-only because Node relies on /proc/self/fd for
// fixed-directory filesystem operations. Ubuntu CI exercises this suite.
const describeOnLinux = process.platform === 'linux' ? describe : describe.skip;

describeOnLinux('UploadService batch all-or-nothing compensation', () => {
  let uploadDir: string;
  let actualFsp: typeof import('fs/promises');
  let harness: ReturnType<typeof createPrismaHarness>;
  let service: UploadService;

  function storageKeyFor(originalName: string): string {
    const call = harness.prisma.fileAsset.create.mock.calls.find(
      ([args]) => args.data.originalName === originalName
    );
    expect(call, `missing FileAsset.create call for ${originalName}`).toBeDefined();
    return call?.[0].data.storageKey ?? '';
  }

  function absolutePathFor(originalName: string): string {
    return path.join(uploadDir, storageKeyFor(originalName));
  }

  beforeEach(async () => {
    vi.clearAllMocks();
    actualFsp = await vi.importActual<typeof import('fs/promises')>('fs/promises');
    vi.mocked(fsp.unlink).mockImplementation((target) => actualFsp.unlink(target));

    let randomIndex = 0;
    vi.mocked(crypto.randomBytes).mockImplementation(() => {
      const value = randomIndex.toString(16).padStart(32, '0');
      randomIndex += 1;
      return Buffer.from(value, 'hex');
    });
    let uuidIndex = 0;
    vi.mocked(crypto.randomUUID).mockImplementation(() => {
      uuidIndex += 1;
      return `00000000-0000-4000-8000-${uuidIndex.toString().padStart(12, '0')}`;
    });

    uploadDir = await actualFsp.mkdtemp(path.join(tmpdir(), 'upload-batch-'));
    harness = createPrismaHarness();
    const configService = {
      get: vi.fn((key: string) => {
        if (key === 'UPLOAD_DIR') return uploadDir;
        if (key === 'UPLOAD_BASE_URL') return 'http://localhost:3000/uploads';
        if (key === 'PORT') return 3000;
        if (key === 'API_PREFIX') return 'api';
        if (key === 'PUBLIC_API_BASE_URL') return 'https://api.example.test';
        if (key === 'JWT_SECRET') return 'test-upload-signing-secret';
        return undefined;
      }),
    };
    service = new UploadService(configService as unknown as ConfigService, harness.prisma as never);
  });

  afterEach(async () => {
    await service.onModuleDestroy();
    await actualFsp.rm(uploadDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('returns all-success results in input order with the existing response shape', async () => {
    const results = await service.uploadFiles(
      [buildFile('first.png', 'first'), buildFile('second.png', 'second')],
      'employee-1'
    );

    expect(results.map((result) => result.originalName)).toEqual(['first.png', 'second.png']);
    expect(results.map((result) => result.id)).toEqual([
      '00000000-0000-4000-8000-000000000001',
      '00000000-0000-4000-8000-000000000002',
    ]);
    expect(Object.keys(results[0] ?? {}).sort()).toEqual(
      ['downloadUrl', 'filename', 'id', 'mimeType', 'originalName', 'size', 'url'].sort()
    );
    expect(harness.prisma.$transaction).toHaveBeenCalledTimes(2);
    expect(harness.executeRaw).toHaveBeenCalledTimes(2);
    expect(await actualFsp.readFile(absolutePathFor('first.png'), 'utf8')).toBe('first');
    expect(await actualFsp.readFile(absolutePathFor('second.png'), 'utf8')).toBe('second');
  });

  it('waits for allSettled multi-failures and compensates successful plus ambiguous commits', async () => {
    const earlyFailure = createDeferred();
    const lateSuccess = createDeferred();
    const lateAmbiguousFailure = createDeferred();
    const settledNames: string[] = [];
    harness.prisma.fileAsset.create.mockImplementation(async ({ data }: CreateArgs) => {
      if (data.originalName === 'failed-before-commit.png') {
        await earlyFailure.promise;
        settledNames.push(data.originalName);
        throw new Error('create rejected before commit');
      }
      if (data.originalName === 'success.png') {
        await lateSuccess.promise;
        settledNames.push(data.originalName);
        harness.rows.push({
          id: data.id,
          ownerEmployeeId: data.ownerEmployeeId,
          storageKey: data.storageKey,
          originalName: data.originalName,
        });
        return { id: data.id };
      }

      await lateAmbiguousFailure.promise;
      settledNames.push(data.originalName);
      harness.rows.push({
        id: data.id,
        ownerEmployeeId: data.ownerEmployeeId,
        storageKey: data.storageKey,
        originalName: data.originalName,
      });
      throw new Error('transport failed after commit');
    });

    const observed = service
      .uploadFiles(
        [
          buildFile('success.png'),
          buildFile('failed-before-commit.png'),
          buildFile('committed-then-rejected.png'),
        ],
        'employee-1'
      )
      .then(
        (value) => ({ status: 'fulfilled' as const, value }),
        (error: unknown) => ({ status: 'rejected' as const, error })
      );
    let responseSettled = false;
    void observed.then(() => {
      responseSettled = true;
    });
    await vi.waitFor(() => expect(harness.prisma.fileAsset.create).toHaveBeenCalledTimes(3));

    earlyFailure.resolve();
    await new Promise((resolve) => setImmediate(resolve));
    expect(responseSettled).toBe(false);

    lateSuccess.resolve();
    await new Promise((resolve) => setImmediate(resolve));
    expect(responseSettled).toBe(false);

    lateAmbiguousFailure.resolve();
    const result = await observed;
    expect(result.status).toBe('rejected');
    if (result.status === 'rejected') {
      expect(result.error).toEqual(expect.any(InternalServerErrorException));
    }

    expect(settledNames).toEqual([
      'failed-before-commit.png',
      'success.png',
      'committed-then-rejected.png',
    ]);
    expect(harness.rows).toEqual([]);
    expect(harness.prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: 'Serializable',
    });
    const queriedWhere = harness.prisma.fileAsset.findMany.mock.calls[0]?.[0].where;
    if (!queriedWhere) throw new Error('missing compensation query');
    expect(queriedWhere.OR).toHaveLength(3);
    expect(queriedWhere.OR).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: '00000000-0000-4000-8000-000000000003',
          ownerEmployeeId: 'employee-1',
          storageKey: storageKeyFor('committed-then-rejected.png'),
        }),
      ])
    );
    for (const name of ['success.png', 'failed-before-commit.png', 'committed-then-rejected.png']) {
      await expect(actualFsp.access(absolutePathFor(name))).rejects.toThrow();
    }
  });

  it('never deletes another owner asset and uses exact id + owner + storageKey predicates', async () => {
    harness.rows.push({
      id: 'foreign-asset',
      ownerEmployeeId: 'employee-other',
      storageKey: '19990101/foreign.png',
      originalName: 'foreign.png',
    });
    harness.prisma.fileAsset.create.mockImplementation(async ({ data }: CreateArgs) => {
      if (data.originalName === 'failed.png') throw new Error('rejected');
      harness.rows.push({
        id: data.id,
        ownerEmployeeId: data.ownerEmployeeId,
        storageKey: data.storageKey,
        originalName: data.originalName,
      });
      return { id: data.id };
    });

    await expect(
      service.uploadFiles([buildFile('success.png'), buildFile('failed.png')], 'employee-1')
    ).rejects.toThrow('Batch upload failed');

    expect(harness.rows).toEqual([
      expect.objectContaining({
        id: 'foreign-asset',
        ownerEmployeeId: 'employee-other',
        storageKey: '19990101/foreign.png',
      }),
    ]);
    const deleteWhere = harness.prisma.fileAsset.deleteMany.mock.calls[0]?.[0].where;
    if (!deleteWhere) throw new Error('missing exact compensation delete');
    expect(deleteWhere.OR).toEqual([
      {
        id: '00000000-0000-4000-8000-000000000001',
        ownerEmployeeId: 'employee-1',
        storageKey: storageKeyFor('success.png'),
      },
    ]);
  });

  it('preserves the file and foreign row when an exact candidate conflicts on storageKey', async () => {
    harness.prisma.fileAsset.create.mockImplementation(async ({ data }: CreateArgs) => {
      harness.rows.push({
        id: 'foreign-concurrent-winner',
        ownerEmployeeId: 'employee-other',
        storageKey: data.storageKey,
        originalName: 'foreign.png',
      });
      throw new Error('unique storage key conflict');
    });

    await expect(
      service.uploadFiles([buildFile('conflict.png', 'preserve-me')], 'employee-1')
    ).rejects.toThrow('cleanup was incomplete');

    expect(harness.prisma.fileAsset.deleteMany).not.toHaveBeenCalled();
    expect(harness.rows).toEqual([
      expect.objectContaining({
        id: 'foreign-concurrent-winner',
        ownerEmployeeId: 'employee-other',
        storageKey: storageKeyFor('conflict.png'),
      }),
    ]);
    expect(await actualFsp.readFile(absolutePathFor('conflict.png'), 'utf8')).toBe('preserve-me');
  });

  it('rolls back and preserves files when query/count changes before delete', async () => {
    harness.prisma.fileAsset.create.mockImplementation(async ({ data }: CreateArgs) => {
      if (data.originalName === 'failed.png') throw new Error('rejected');
      harness.rows.push({
        id: data.id,
        ownerEmployeeId: data.ownerEmployeeId,
        storageKey: data.storageKey,
        originalName: data.originalName,
      });
      return { id: data.id };
    });
    harness.prisma.fileAsset.count.mockResolvedValueOnce(1).mockResolvedValueOnce(0);
    const loggerError = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

    await expect(
      service.uploadFiles([buildFile('success.png', 'keep'), buildFile('failed.png')], 'employee-1')
    ).rejects.toThrow('cleanup was incomplete');

    expect(harness.prisma.fileAsset.deleteMany).not.toHaveBeenCalled();
    expect(harness.rows).toHaveLength(1);
    expect(await actualFsp.readFile(absolutePathFor('success.png'), 'utf8')).toBe('keep');
    expect(loggerError).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'upload.batch.db-compensation.failed',
        stage: 'database-query-count',
      })
    );
  });

  it('rolls back all DB deletions when deleteMany count is short', async () => {
    harness.prisma.fileAsset.create.mockImplementation(async ({ data }: CreateArgs) => {
      if (data.originalName === 'failed.png') throw new Error('rejected');
      harness.rows.push({
        id: data.id,
        ownerEmployeeId: data.ownerEmployeeId,
        storageKey: data.storageKey,
        originalName: data.originalName,
      });
      return { id: data.id };
    });
    harness.prisma.fileAsset.deleteMany.mockImplementationOnce(async ({ where }) => {
      const matched = harness.rows.filter((asset) => matchesWhere(asset, where));
      const first = matched[0];
      if (first) {
        const index = harness.rows.indexOf(first);
        harness.rows.splice(index, 1);
      }
      return { count: 1 };
    });

    await expect(
      service.uploadFiles(
        [buildFile('success-a.png'), buildFile('success-b.png'), buildFile('failed.png')],
        'employee-1'
      )
    ).rejects.toThrow('cleanup was incomplete');

    expect(harness.rows.map((row) => row.originalName).sort()).toEqual([
      'success-a.png',
      'success-b.png',
    ]);
    expect(await actualFsp.readFile(absolutePathFor('success-a.png'), 'utf8')).toBe(
      'success-a.png'
    );
    expect(await actualFsp.readFile(absolutePathFor('success-b.png'), 'utf8')).toBe(
      'success-b.png'
    );
  });

  it('reports partial file cleanup failure on unlink EACCES without leaking names or absolute paths', async () => {
    harness.prisma.fileAsset.create.mockImplementation(async ({ data }: CreateArgs) => {
      if (data.originalName === 'failed.png') throw new Error('rejected');
      harness.rows.push({
        id: data.id,
        ownerEmployeeId: data.ownerEmployeeId,
        storageKey: data.storageKey,
        originalName: data.originalName,
      });
      return { id: data.id };
    });
    const blockedName = 'blocked-sensitive-name.png';
    vi.mocked(fsp.unlink).mockImplementation(async (target) => {
      let isolatedContent: string | undefined;
      try {
        isolatedContent = await actualFsp.readFile(target, 'utf8');
      } catch {
        // The production unlink still decides how to report a missing entry.
      }
      if (isolatedContent === 'blocked') {
        throw Object.assign(new Error('permission denied'), { code: 'EACCES' });
      }
      return actualFsp.unlink(target);
    });
    const loggerError = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

    const pending = service.uploadFiles(
      [buildFile(blockedName, 'blocked'), buildFile('removable.png'), buildFile('failed.png')],
      'employee-1'
    );

    await expect(pending).rejects.toEqual(expect.any(InternalServerErrorException));
    await expect(pending).rejects.toThrow('cleanup was incomplete');

    const blockedPath = absolutePathFor(blockedName);
    expect(harness.rows).toEqual([]);
    await expect(actualFsp.access(blockedPath)).rejects.toThrow();
    const quarantine = path.join(path.dirname(blockedPath), '.ky-upload-quarantine');
    const residualSlots = await actualFsp.readdir(quarantine);
    expect(residualSlots).toHaveLength(1);
    const residualSlot = residualSlots[0];
    if (!residualSlot) throw new Error('missing isolated cleanup residual');
    expect(await actualFsp.readFile(path.join(quarantine, residualSlot, 'entry'), 'utf8')).toBe(
      'blocked'
    );
    await expect(actualFsp.access(absolutePathFor('removable.png'))).rejects.toThrow();
    expect(loggerError).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'upload.batch.file-cleanup.failed',
        candidateCount: 3,
        deletedCount: 2,
        failedItems: [expect.objectContaining({ cleanupFailureCode: 'EACCES' })],
      })
    );
    const serializedLogs = JSON.stringify(loggerError.mock.calls);
    expect(serializedLogs).not.toContain(uploadDir);
    expect(serializedLogs).not.toContain(blockedName);
    expect(serializedLogs).not.toContain('failed.png');
  });

  it('retries EEXIST with wx and never overwrites an existing file', async () => {
    const now = 1_787_565_000_000;
    vi.spyOn(Date, 'now').mockReturnValue(now);
    const collisionHash = '11'.repeat(16);
    const fallbackHash = '22'.repeat(16);
    let hashCall = 0;
    vi.mocked(crypto.randomBytes).mockImplementation(() => {
      hashCall += 1;
      return Buffer.from(hashCall === 1 ? collisionHash : fallbackHash, 'hex');
    });
    const dateDirectory = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const existingPath = path.join(uploadDir, dateDirectory, `${now}-${collisionHash}.png`);
    await actualFsp.mkdir(path.dirname(existingPath), { recursive: true });
    await actualFsp.writeFile(existingPath, 'historical');

    const result = await service.uploadFile(buildFile('new.png', 'new'), 'employee-1');

    expect(result.filename).toBe(`${now}-${fallbackHash}.png`);
    expect(await actualFsp.readFile(existingPath, 'utf8')).toBe('historical');
    expect(
      await actualFsp.readFile(path.join(uploadDir, dateDirectory, result.filename), 'utf8')
    ).toBe('new');
  });

  it('survives a concurrent first-candidate collision without overwrite', async () => {
    const sharedHash = '33'.repeat(16);
    let hashCall = 0;
    vi.mocked(crypto.randomBytes).mockImplementation(() => {
      const current = hashCall;
      hashCall += 1;
      if (current === 0 || current === 8) return Buffer.from(sharedHash, 'hex');
      return Buffer.from((current + 1).toString(16).padStart(32, '0'), 'hex');
    });

    const results = await service.uploadFiles(
      [buildFile('first.png', 'first-content'), buildFile('second.png', 'second-content')],
      'employee-1'
    );

    expect(new Set(results.map((result) => result.filename)).size).toBe(2);
    expect(results.some((result) => result.filename.includes(sharedHash))).toBe(true);
    expect(await actualFsp.readFile(absolutePathFor('first.png'), 'utf8')).toBe('first-content');
    expect(await actualFsp.readFile(absolutePathFor('second.png'), 'utf8')).toBe('second-content');
  });
});
