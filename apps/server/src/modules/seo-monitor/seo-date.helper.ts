/**
 * SEO 监测模块专用日期 helper —— 处理 sync 侧写入与 service 读出的时区错位。
 *
 * ⚠️ 已知 sync 侧 bug（参见 apps/seo-sync/src/sync/sync-bing.ts:88 / sync-clarity.ts）：
 *   sync 调用 `new Date(\`${beijingDate}T00:00:00+08:00\`)` 写入 `statDate` 字段，
 *   该 Date 对应 UTC `${beijingDate-1d}T16:00:00Z`；Prisma 写 @db.Date 时按 UTC date
 *   部分入库，实际存的是 `beijingDate - 1d`。
 *
 *   读出时 Prisma 返回 UTC midnight 的 Date 对象（仍是北京日 -1d 那一天的 0 点 UTC）。
 *
 * 治本方案（未来）：sync 侧改为 `new Date(\`${date}T00:00:00.000Z\`)` UTC 0 点写入，
 *   并对存量数据做 backfill (`statDate = statDate + interval '1 day'`)。
 *
 * 治标方案（本期）：service 层 helper 与 sync 侧完全对称：
 *   - `beijingDayStartForQuery('2026-05-25')` → `new Date('2026-05-25T00:00:00+08:00')`
 *     （与 sync 同款，让 where 条件能匹配实际入库的行）
 *   - `beijingDayNextStartForQuery('2026-05-25')` → 加 24h 用作半开右界 (`lt`)
 *   - `prismaDateToBeijingString(rowDate)` → 把 PG 读出的 UTC midnight Date 加 1d
 *     还原为用户期望的北京日字符串（这是治标，依赖 sync 侧的 -1d 偏差）
 *
 * 本 helper 仅适用于 `@db.Date` 字段（如 SEO 4 张表的 statDate）；
 * 普通 `DateTime` 字段（如 startedAt）不受此问题影响，沿用 ISO 字符串即可。
 */

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

/**
 * 北京日字符串 → 用于 Prisma where 的 Date 对象（含当日 0 点起）。
 * 与 seo-sync 写入侧 `new Date(\`${date}T00:00:00+08:00\`)` 完全一致。
 */
export function beijingDayStartForQuery(beijingDate: string): Date {
  return new Date(`${beijingDate}T00:00:00+08:00`);
}

/**
 * 北京日字符串 → 次日 0 点 Date 对象（半开右界 `lt`，包含当天全部数据）。
 */
export function beijingDayNextStartForQuery(beijingDate: string): Date {
  return new Date(new Date(`${beijingDate}T00:00:00+08:00`).getTime() + ONE_DAY_MS);
}

/**
 * Prisma 从 `@db.Date` 字段读出的 Date（UTC midnight）→ 北京日字符串 `YYYY-MM-DD`。
 *
 * 校正策略：sync 写入触发 -1d 偏差，读出时 +1d 还原为用户期望的"北京日"。
 */
export function prismaDateToBeijingString(d: Date | string | null | undefined): string | null {
  if (d == null) return null;
  if (typeof d === 'string') {
    // 已经是字符串（理论上不该发生，保险起见直接透传前 10 位）
    return d.slice(0, 10);
  }
  const corrected = new Date(d.getTime() + ONE_DAY_MS);
  return corrected.toISOString().slice(0, 10);
}

/**
 * 构造 Prisma `where.statDate` 的范围筛选条件（半开区间）。
 * 任一端为 undefined 时跳过；两端都为 undefined 时返回 undefined。
 */
export function buildBeijingDateRangeFilter(
  startDate: string | undefined,
  endDate: string | undefined
): { gte?: Date; lt?: Date } | undefined {
  if (!startDate && !endDate) return undefined;
  const filter: { gte?: Date; lt?: Date } = {};
  if (startDate) filter.gte = beijingDayStartForQuery(startDate);
  if (endDate) filter.lt = beijingDayNextStartForQuery(endDate);
  return filter;
}
