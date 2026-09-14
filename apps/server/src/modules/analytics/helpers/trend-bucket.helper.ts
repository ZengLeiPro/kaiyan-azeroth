/**
 * 趋势按桶（day / week / month）聚合工具
 *
 * 输入是若干条 `{ at: Date, value: number }`，输出是按桶聚合的 `ITrendPoint[]`。
 * 桶标签：
 *   day   → YYYY-MM-DD
 *   week  → YYYY-Www（ISO 周）
 *   month → YYYY-MM
 *
 * 空桶用 0 填充以便折线图连续，调用方可选 fillZero（默认 true）。
 */

import type { TrendBucket } from '@ky-azeroth/shared/schemas';
import type { ITrendPoint } from '@ky-azeroth/shared/types';

export interface TrendInputRow {
  at: Date;
  value: number;
  /** 可选：作为 ITrendPoint.count 透传，常用于"金额 + 记录数"双字段 */
  count?: number;
}

const pad = (n: number, len = 2) => String(n).padStart(len, '0');

const bucketKey = (d: Date, bucket: TrendBucket): string => {
  const y = d.getFullYear();
  const m = pad(d.getMonth() + 1);
  const day = pad(d.getDate());
  if (bucket === 'day') return `${y}-${m}-${day}`;
  if (bucket === 'month') return `${y}-${m}`;
  // ISO week
  const target = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = target.getUTCDay() || 7;
  target.setUTCDate(target.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(target.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((target.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${target.getUTCFullYear()}-W${pad(week)}`;
};

const advance = (d: Date, bucket: TrendBucket): Date => {
  const next = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  if (bucket === 'day') next.setDate(next.getDate() + 1);
  else if (bucket === 'week') next.setDate(next.getDate() + 7);
  else next.setMonth(next.getMonth() + 1);
  return next;
};

/**
 * 按桶聚合并填充空桶
 */
export function bucketizeTrend(
  rows: TrendInputRow[],
  start: Date,
  endExclusive: Date,
  bucket: TrendBucket,
  options?: { fillZero?: boolean }
): ITrendPoint[] {
  const fillZero = options?.fillZero ?? true;

  const sums = new Map<string, { value: number; count: number }>();
  for (const r of rows) {
    if (!r.at) continue;
    const k = bucketKey(r.at, bucket);
    const prev = sums.get(k) ?? { value: 0, count: 0 };
    prev.value += Number(r.value) || 0;
    prev.count += Number(r.count ?? 0);
    sums.set(k, prev);
  }

  if (!fillZero) {
    return Array.from(sums.entries())
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([bucketKey, v]) => ({ bucket: bucketKey, value: v.value, count: v.count }));
  }

  const out: ITrendPoint[] = [];
  let cur = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  // week 桶对齐到周一
  if (bucket === 'week') {
    const day = cur.getDay() || 7;
    cur.setDate(cur.getDate() - (day - 1));
  }
  // month 桶对齐到 1 号
  if (bucket === 'month') {
    cur = new Date(cur.getFullYear(), cur.getMonth(), 1);
  }
  let safety = 0;
  while (cur < endExclusive && safety++ < 5000) {
    const k = bucketKey(cur, bucket);
    const v = sums.get(k) ?? { value: 0, count: 0 };
    out.push({ bucket: k, value: v.value, count: v.count });
    cur = advance(cur, bucket);
  }
  return out;
}
