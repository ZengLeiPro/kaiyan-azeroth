import { ConfigService } from '@nestjs/config';
import * as fsp from 'fs/promises';
import { tmpdir } from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { UploadService } from '../upload.service';
import {
  sortUploadAssetLockIdentities,
  uploadAssetAdvisoryLockKey,
} from '../upload-asset-lock.helper';

type Deferred = { promise: Promise<void>; resolve: () => void };

type StoredAsset = {
  id: string;
  ownerEmployeeId: string;
  storageKey: string;
  originalName: string;
};

function deferred(): Deferred {
  let resolve!: () => void;
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function buildFile() {
  const buffer = Buffer.from('lock-contract');
  return {
    originalname: 'contract.png',
    buffer,
    size: buffer.length,
    mimetype: 'image/png',
  };
}

function matches(asset: StoredAsset, where: unknown): boolean {
  const conditions = (where as { OR?: unknown[] }).OR ?? [];
  return conditions.some((condition) => {
    const candidate = condition as {
      id?: string | { in?: string[] };
      ownerEmployeeId?: string;
      storageKey?: string | { in?: string[] };
    };
    if (typeof candidate.id === 'string' && typeof candidate.storageKey === 'string') {
      return (
        asset.id === candidate.id &&
        asset.ownerEmployeeId === candidate.ownerEmployeeId &&
        asset.storageKey === candidate.storageKey
      );
    }
    if (typeof candidate.id === 'object') return candidate.id.in?.includes(asset.id) ?? false;
    if (typeof candidate.storageKey === 'object') {
      return candidate.storageKey.in?.includes(asset.storageKey) ?? false;
    }
    return false;
  });
}

// The service constructor deliberately fails closed outside Linux; Ubuntu CI
// provides /proc/self/fd and runs the full advisory-lock contract.
describe.runIf(process.platform === 'linux')('Upload FileAsset advisory-lock contract', () => {
  const roots = new Set<string>();
  const services = new Set<UploadService>();

  afterEach(async () => {
    for (const service of services) await service.onModuleDestroy().catch(() => undefined);
    services.clear();
    for (const root of roots) await fsp.rm(root, { recursive: true, force: true });
    roots.clear();
    vi.restoreAllMocks();
  });

  it('uses one exact assetId/storageKey key and sorts multi-lock acquisition deterministically', () => {
    const identities = [
      { id: 'asset-z', storageKey: '20260824/z.png' },
      { id: 'asset-a', storageKey: '20260824/a.png' },
      { id: 'asset-z', storageKey: '20260824/a.png' },
    ];

    const ordered = sortUploadAssetLockIdentities(identities);

    expect(ordered.map(uploadAssetAdvisoryLockKey)).toEqual(
      identities.map(uploadAssetAdvisoryLockKey).sort()
    );
    expect(uploadAssetAdvisoryLockKey(identities[0]!)).toBe(
      JSON.stringify(['upload_file_asset', 'asset-z', '20260824/z.png'])
    );
    expect(() => uploadAssetAdvisoryLockKey({ id: '', storageKey: 'x' })).toThrow(
      'identity is incomplete'
    );
  });

  it('waits for an ambiguous creator lock, ends the barrier, then queries in a new transaction', async () => {
    const root = await fsp.mkdtemp(path.join(tmpdir(), 'upload-lock-contract-'));
    roots.add(root);
    const creatorCommit = deferred();
    const creatorLockReleased = deferred();
    const rows: StoredAsset[] = [];
    const events: string[] = [];
    const lockKeys: string[] = [];
    const transactionOptions: unknown[] = [];
    let pendingCreate: StoredAsset | undefined;
    let transactionIndex = 0;

    const prisma = {
      $transaction: vi.fn(
        async (
          callback: (transaction: unknown) => Promise<unknown>,
          options?: { isolationLevel?: string }
        ) => {
          transactionOptions.push(options);
          transactionIndex += 1;
          if (transactionIndex === 1) {
            const transaction = {
              $executeRaw: vi.fn(async (...args: unknown[]) => {
                lockKeys.push(String(args[1]));
                events.push('creator-lock-acquired');
                return 1;
              }),
              fileAsset: {
                create: vi.fn(async ({ data }: { data: StoredAsset }) => {
                  events.push('creator-insert-issued');
                  pendingCreate = { ...data };
                  return { id: data.id };
                }),
              },
            };
            await callback(transaction);
            events.push('creator-client-rejected');
            void creatorCommit.promise.then(() => {
              if (!pendingCreate) throw new Error('creator row was not staged');
              rows.push(pendingCreate);
              events.push('creator-commit-visible');
              creatorLockReleased.resolve();
            });
            throw new Error('connection lost after server-side commit became ambiguous');
          }

          if (transactionIndex === 2) {
            const transaction = {
              $executeRaw: vi.fn(async (...args: unknown[]) => {
                lockKeys.push(String(args[1]));
                events.push('barrier-lock-requested');
                await creatorLockReleased.promise;
                events.push('barrier-lock-acquired');
                return 1;
              }),
              fileAsset: {},
            };
            const result = await callback(transaction);
            events.push('barrier-transaction-ended');
            return result;
          }

          if (transactionIndex === 3) {
            const transaction = {
              $executeRaw: vi.fn(async (...args: unknown[]) => {
                lockKeys.push(String(args[1]));
                events.push('compensation-lock-acquired');
                return 1;
              }),
              fileAsset: {
                findMany: vi.fn(async ({ where }: { where: unknown }) => {
                  events.push('compensation-query');
                  return rows
                    .filter((asset) => matches(asset, where))
                    .map(({ id, ownerEmployeeId, storageKey }) => ({
                      id,
                      ownerEmployeeId,
                      storageKey,
                    }));
                }),
                count: vi.fn(
                  async ({ where }: { where: unknown }) =>
                    rows.filter((asset) => matches(asset, where)).length
                ),
                deleteMany: vi.fn(async ({ where }: { where: unknown }) => {
                  const before = rows.length;
                  const retained = rows.filter((asset) => !matches(asset, where));
                  rows.splice(0, rows.length, ...retained);
                  events.push('compensation-delete');
                  return { count: before - retained.length };
                }),
              },
            };
            return callback(transaction);
          }

          throw new Error(`unexpected transaction ${transactionIndex}`);
        }
      ),
    };
    const config = {
      get: vi.fn((key: string) => {
        if (key === 'UPLOAD_DIR') return root;
        if (key === 'UPLOAD_BASE_URL') return 'http://localhost:3000/uploads';
        if (key === 'PORT') return 3000;
        if (key === 'API_PREFIX') return 'api';
        if (key === 'JWT_SECRET') return 'upload-lock-contract-secret';
        return undefined;
      }),
    };
    const service = new UploadService(config as unknown as ConfigService, prisma as never);
    services.add(service);

    const upload = service.uploadFile(buildFile(), 'employee-1');
    await vi.waitFor(() => expect(events).toContain('barrier-lock-requested'));

    expect(rows).toEqual([]);
    expect(events).not.toContain('barrier-lock-acquired');
    expect(events).not.toContain('compensation-query');

    creatorCommit.resolve();
    await expect(upload).rejects.toThrow('File upload failed');

    expect(rows).toEqual([]);
    expect(lockKeys).toHaveLength(3);
    expect(new Set(lockKeys).size).toBe(1);
    expect(transactionOptions).toEqual([
      { isolationLevel: 'Serializable' },
      { isolationLevel: 'Serializable' },
      { isolationLevel: 'Serializable' },
    ]);
    expect(events).toEqual([
      'creator-lock-acquired',
      'creator-insert-issued',
      'creator-client-rejected',
      'barrier-lock-requested',
      'creator-commit-visible',
      'barrier-lock-acquired',
      'barrier-transaction-ended',
      'compensation-lock-acquired',
      'compensation-query',
      'compensation-delete',
    ]);
  });
});
