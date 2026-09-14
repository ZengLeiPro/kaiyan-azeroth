export interface VersionedProductSnapshot {
  id: string;
  version: number;
}

export interface ProductSnapshotDiff<TExisting extends VersionedProductSnapshot, TRequested> {
  unchanged: TExisting[];
  removed: TExisting[];
  created: TRequested[];
}

/**
 * 产品明细采用不可变快照语义：内容完全相同的行保留原 id/version；变化行软删后新增。
 *
 * fingerprint 必须把 Decimal/null 等数据库表示规范化。相同指纹以 existing.id 排序后一一
 * 配对，因此重复产品也能稳定 diff，不会因请求顺序变化而无条件重建全部明细。
 */
export function diffProductSnapshots<TExisting extends VersionedProductSnapshot, TRequested>(
  existingRows: readonly TExisting[],
  requestedRows: readonly TRequested[],
  existingFingerprint: (row: TExisting) => string,
  requestedFingerprint: (row: TRequested) => string
): ProductSnapshotDiff<TExisting, TRequested> {
  const availableByFingerprint = new Map<string, TExisting[]>();
  for (const row of [...existingRows].sort((left, right) => left.id.localeCompare(right.id))) {
    const fingerprint = existingFingerprint(row);
    const bucket = availableByFingerprint.get(fingerprint) ?? [];
    bucket.push(row);
    availableByFingerprint.set(fingerprint, bucket);
  }

  const unchanged: TExisting[] = [];
  const created: TRequested[] = [];
  for (const requested of requestedRows) {
    const fingerprint = requestedFingerprint(requested);
    const matched = availableByFingerprint.get(fingerprint)?.shift();
    if (matched) {
      unchanged.push(matched);
    } else {
      created.push(requested);
    }
  }

  const removed = [...availableByFingerprint.values()]
    .flat()
    .sort((left, right) => left.id.localeCompare(right.id));
  return { unchanged, removed, created };
}

/** Decimal/number/string 的比较键；null 与 undefined 统一为空，避免纯表示差异触发替换。 */
export function decimalProductFingerprint(value: unknown): string | null {
  if (value == null || value === '') return null;
  const normalized = String(value);
  const numeric = Number(normalized);
  if (!Number.isFinite(numeric)) return normalized;
  if (Object.is(numeric, -0)) return '0';
  return numeric.toString();
}
