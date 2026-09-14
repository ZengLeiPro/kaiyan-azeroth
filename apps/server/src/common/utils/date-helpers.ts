/**
 * 客户端日期时间字符串解析兜底
 *
 * 历史 bug：前端 `<input type="datetime-local">` 产出无时区字符串
 * （`YYYY-MM-DDTHH:mm`），早期 payload 转换层未 toISOString 就直接透传。
 * 后端容器在 UTC 时区，`new Date("2026-05-13T19:00")` 会被当 UTC 解析，
 * 实际偏差 +8h。前端已修复（统一走 localInputToIso），这里作为兜底，
 * 防止外部脚本/历史前端再次踩坑。
 */
const CLIENT_TZ_OFFSET = '+08:00';

const HAS_OFFSET_RE = /(?:Z|[+-]\d{2}:?\d{2})$/;

/**
 * 解析来自客户端的日期时间字符串：
 * - 带 `Z` 或 `±HH:MM` 后缀 → 直接交给 Date 解析
 * - 无时区后缀 → 视为上海本地时间（追加 `+08:00`）
 * - 空值 → 返回 null
 */
export function parseClientDateTime(input: string | Date | null | undefined): Date | null {
  if (input === null || input === undefined || input === '') return null;
  if (input instanceof Date) return input;

  const trimmed = input.trim();
  if (!trimmed) return null;

  const normalized = HAS_OFFSET_RE.test(trimmed) ? trimmed : `${trimmed}${CLIENT_TZ_OFFSET}`;
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}
