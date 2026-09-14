/**
 * 把 Date 格式化成 YYYY-MM-DD（UTC+8 北京时区）。
 *
 * Bing 返回的 Date 字段是 `/Date(1748102400000)/` 格式（毫秒时间戳 + WCF JSON 风格）。
 * Clarity 返回的日期是 ISO 字符串。
 */
export function formatBeijingDate(d: Date): string {
  // 借助 toLocaleDateString 走 zh-CN + Asia/Shanghai
  const parts = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(d);
  const y = parts.find((p) => p.type === 'year')?.value ?? '1970';
  const m = parts.find((p) => p.type === 'month')?.value ?? '01';
  const day = parts.find((p) => p.type === 'day')?.value ?? '01';
  return `${y}-${m}-${day}`;
}

/**
 * 把 Bing 返回的 `/Date(1748102400000)/` 或 `/Date(1316156400000-0700)/`
 * 字符串解析为 Date 对象。
 *
 * Bing Webmaster API 官方样例日期带时区偏移（如 `-0700`），
 * 老版本正则 `^/Date(\d+)/$` 会把它们全部解析失败，导致 rows.length=0
 * 但 sync 仍记 success（"假成功"）。这里同时兼容两种格式。
 */
export function parseBingDate(s: string): Date | null {
  const m = s.match(/^\/Date\((-?\d+)(?:[+-]\d{4})?\)\/$/);
  if (m) return new Date(Number(m[1]));
  // 兜底：尝试 ISO 解析
  const ts = Date.parse(s);
  return Number.isNaN(ts) ? null : new Date(ts);
}

/**
 * N 天前的北京日期
 */
export function daysAgoBeijing(n: number): string {
  const d = new Date(Date.now() - n * 86400_000);
  return formatBeijingDate(d);
}

/**
 * 简单 sleep 工具，毫秒
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
