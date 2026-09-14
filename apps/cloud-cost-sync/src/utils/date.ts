/**
 * 日期与时间工具：所有业务日期统一以 UTC+8（北京时间）为准。
 *
 * 为什么不直接用 toLocaleString：FC 容器时区可能是 UTC（默认）或被 CRON_TZ 干预，
 * 不可信。统一用偏移量算，避免环境差异。
 */

export const BJ_OFFSET_MS = 8 * 60 * 60 * 1000;

/** 把 Date 转换为 UTC+8 时区下的"墙上时间"（仍是 Date 类型，但其 UTC 字段就是北京时间） */
export function toBeijing(date: Date | number = Date.now()): Date {
  const ms = typeof date === 'number' ? date : date.getTime();
  return new Date(ms + BJ_OFFSET_MS);
}

/** 北京时间今天的 YYYY-MM-DD */
export function todayBeijing(now: Date = new Date()): string {
  const d = toBeijing(now);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** 北京时间当前月份 YYYY-MM */
export function currentCycleBeijing(now: Date = new Date()): string {
  const d = toBeijing(now);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

/** 上一个月 YYYY-MM */
export function previousCycle(cycle: string): string {
  const parts = cycle.split('-');
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new Error(`无效的账期格式: ${cycle}`);
  }
  let y = Number(parts[0]);
  let m = Number(parts[1]);
  if (!Number.isFinite(y) || !Number.isFinite(m)) {
    throw new Error(`无效的账期: ${cycle}`);
  }
  m -= 1;
  if (m === 0) {
    m = 12;
    y -= 1;
  }
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}`;
}

/** 把 YYYY-MM-DD 转 Date（UTC 00:00） */
export function parseDateOnly(s: string): Date {
  return new Date(`${s}T00:00:00.000Z`);
}

/** 把 N 天前的北京时间 YYYY-MM-DD（含今天则 daysAgo=0） */
export function daysAgoBeijing(daysAgo: number, now: Date = new Date()): string {
  const todayMs = now.getTime() - daysAgo * 86400 * 1000;
  return todayBeijing(new Date(todayMs));
}

/** 把北京时间日期字符串转为该日 00:00:00（北京时间）对应的 UTC 毫秒 */
export function beijingMidnightUtcMs(dateStr: string): number {
  const parts = dateStr.split('-');
  if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) {
    throw new Error(`无效日期: ${dateStr}`);
  }
  const y = Number(parts[0]);
  const m = Number(parts[1]) - 1;
  const d = Number(parts[2]);
  // 北京 00:00 = UTC 前一天 16:00。直接构造 UTC 16:00 of (d-1)。
  return Date.UTC(y, m, d) - BJ_OFFSET_MS;
}

/** 把北京时间日期字符串转为该日 23:59:59.999（北京时间）对应的 UTC 毫秒 */
export function beijingEndOfDayUtcMs(dateStr: string): number {
  return beijingMidnightUtcMs(dateStr) + 86400 * 1000 - 1;
}

/** sleep（QPS 限流用） */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 计算 ISO 时间字符串到指定参考时间的天数差（正数=未来到期） */
export function daysUntil(iso: string | null | undefined, ref: Date = new Date()): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  return Math.floor((t - ref.getTime()) / 86400000);
}

/** 取 ISO 字符串前 10 位（YYYY-MM-DD），失败返回 null */
export function pickDatePart(iso: string | null | undefined): string | null {
  if (!iso || typeof iso !== 'string') return null;
  return iso.length >= 10 ? iso.slice(0, 10) : null;
}
