import type { Prisma } from '@prisma/client';

export interface UploadAssetLockIdentity {
  id: string;
  storageKey: string;
}

/** A single canonical key is shared by create and every compensation phase. */
export function uploadAssetAdvisoryLockKey(identity: UploadAssetLockIdentity): string {
  if (!identity.id || !identity.storageKey) {
    throw new Error('Upload asset advisory lock identity is incomplete');
  }
  return JSON.stringify(['upload_file_asset', identity.id, identity.storageKey]);
}

/** Deterministic multi-lock order prevents two batch compensations from deadlocking. */
export function sortUploadAssetLockIdentities<T extends UploadAssetLockIdentity>(
  identities: readonly T[]
): T[] {
  return [...identities].sort((left, right) => {
    const leftKey = uploadAssetAdvisoryLockKey(left);
    const rightKey = uploadAssetAdvisoryLockKey(right);
    return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
  });
}

/**
 * Serialize FileAsset INSERT and compensation for the exact assetId/storageKey.
 * The transaction-scoped lock is released only after PostgreSQL commits or rolls back.
 */
export async function lockUploadAsset(
  transaction: Prisma.TransactionClient,
  identity: UploadAssetLockIdentity
): Promise<void> {
  const lockKey = uploadAssetAdvisoryLockKey(identity);
  // @prisma-raw-sql: PostgreSQL transaction advisory lock closes ambiguous FileAsset commit/compensation races.
  await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`;
}
