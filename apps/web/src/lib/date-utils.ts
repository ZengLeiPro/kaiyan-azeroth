/**
 * 日期处理工具函数
 * 统一处理 ISO 格式日期字符串和纯日期字符串的转换
 */

/**
 * 从 ISO 日期时间字符串中提取日期部分 (YYYY-MM-DD)
 * 支持以下格式：
 * - ISO 格式: "2024-01-21T08:30:00.000Z" -> "2024-01-21"
 * - 纯日期格式: "2024-01-21" -> "2024-01-21"
 * - null/undefined -> ""
 *
 * @param isoDateTime ISO 格式的日期时间字符串或纯日期字符串
 * @returns 日期部分字符串 (YYYY-MM-DD) 或空字符串
 */
export function extractDatePart(isoDateTime: string | null | undefined): string {
  if (!isoDateTime) return '';
  const dateStr = String(isoDateTime);
  return dateStr.includes('T') ? (dateStr.split('T')[0] ?? '') : dateStr;
}

/**
 * 格式化日期为显示字符串
 * @param date 日期字符串或 Date 对象
 * @param format 格式化模式，默认为 'YYYY-MM-DD'
 * @returns 格式化后的日期字符串
 */
export function formatDateDisplay(
  date: string | Date | null | undefined,
  format: 'YYYY-MM-DD' | 'YYYY/MM/DD' | 'MM-DD' = 'YYYY-MM-DD'
): string {
  if (!date) return '';

  const dateStr =
    typeof date === 'string' ? extractDatePart(date) : formatDateToLocalDateString(date);

  if (!dateStr) return '';

  switch (format) {
    case 'YYYY/MM/DD':
      return dateStr.replace(/-/g, '/');
    case 'MM-DD':
      return dateStr.slice(5);
    case 'YYYY-MM-DD':
    default:
      return dateStr;
  }
}

/**
 * 格式化时间戳为展示字符串（YYYY-MM-DD HH:mm）。
 * 按本地时区呈现，UTC 存库字段会转为浏览器本地时间（生产环境为北京时间）。
 * 纯日期字段请继续用 formatDateDisplay，不要走本函数以免补 00:00。
 */
export function formatDateTimeDisplay(date: string | Date | number | null | undefined): string {
  if (date == null || date === '') return '';
  const dt = typeof date === 'string' || typeof date === 'number' ? new Date(date) : date;
  if (Number.isNaN(dt.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())} ${pad(dt.getHours())}:${pad(dt.getMinutes())}`;
}

/**
 * 将 Date 按本地时区格式化为 YYYY-MM-DD。
 * 不使用 toISOString，避免北京时间 00:00 被转成前一天 UTC 日期。
 */
export function formatDateToLocalDateString(date: Date | null | undefined): string {
  if (!date || Number.isNaN(date.getTime())) return '';
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * 将 YYYY-MM-DD 或 ISO 字符串解析为本地日期。
 */
export function parseLocalDateString(dateStr: string | null | undefined): Date | undefined {
  const datePart = extractDatePart(dateStr);
  if (!datePart) return undefined;
  const [year, month, day] = datePart.split('-').map(Number);
  if (!year || !month || !day) return undefined;
  return new Date(year, month - 1, day);
}

/**
 * 获取当前日期字符串 (YYYY-MM-DD)
 * 用于表单的默认日期值
 *
 * @returns 当前日期字符串，格式为 YYYY-MM-DD
 */
export function getTodayDateString(): string {
  return formatDateToLocalDateString(new Date());
}

/**
 * 获取当前日期时间字符串 (YYYY-MM-DDTHH:mm)
 * 用于 <input type="datetime-local"> 的默认值。
 * 不使用 toISOString，避免 UTC 偏移导致显示与本地时间不一致。
 *
 * @returns 当前日期时间字符串，格式为 YYYY-MM-DDTHH:mm
 */
export function getNowDateTimeLocalString(): string {
  const now = new Date();
  const datePart = formatDateToLocalDateString(now);
  if (!datePart) return '';
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  return `${datePart}T${hours}:${minutes}`;
}

/**
 * 获取 N 年后的日期字符串 (YYYY-MM-DD)。
 * 闰年边界（如 2/29 + 1 年）由 JS Date 自然外溢到下月 1 日，与日历常识一致。
 *
 * @param years 偏移年数，可为负数
 * @returns 偏移后日期字符串，格式为 YYYY-MM-DD
 */
export function getDateAfterYearsString(years: number): string {
  const date = new Date();
  date.setFullYear(date.getFullYear() + years);
  return formatDateToLocalDateString(date);
}

/**
 * ISO 字符串 → `<input type="datetime-local">` 控件字符串 (`YYYY-MM-DDTHH:mm`)。
 * 按本地时区呈现，避免 UTC 偏移导致显示与本地时间不一致。
 */
export function isoToLocalInput(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * `<input type="datetime-local">` 控件字符串 (`YYYY-MM-DDTHH:mm`) → ISO UTC 字符串。
 * 控件本身没有时区概念，`new Date(local)` 按本地时区解析；浏览器在 +8 时即得到正确 UTC。
 *
 * 历史 bug：CRM 跟进/拜访模块的 toXxxPayload 曾直接透传无时区字符串到接口，
 * 后端 UTC 容器 `new Date(...)` 按 UTC 解析，导致 +8h 偏差。统一走此函数。
 */
export function localInputToIso(local: string | null | undefined): string | null {
  if (!local) return null;
  const d = new Date(local);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}
