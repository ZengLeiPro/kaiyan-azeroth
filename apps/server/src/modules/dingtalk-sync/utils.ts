/**
 * dingtalk-sync 模块内部工具函数（精简版）
 *
 * 仅包含日志/日历同步所需，去掉了原 apps/dingtalk-sync/src/utils.ts 中
 * 与 YCCRM / Decimal / approval 等无关的部分。
 */

/** 将未知值标准化为字符串，null/undefined 转为空字符串 */
export function normalizeText(v: unknown): string {
  if (v === null || v === undefined) return '';
  return String(v).trim();
}

/** 安全的 JSON 序列化 */
export function safeJsonStringify(v: unknown): string {
  try {
    return JSON.stringify(v ?? null);
  } catch {
    return 'null';
  }
}

/** 等待指定毫秒 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 格式化 ISO 时间（带时区偏移，默认 +08:00） */
export function formatIsoWithOffset(date: Date, offsetHours: number = 8): string {
  const ms = date.getTime() + offsetHours * 3600 * 1000;
  const d = new Date(ms);
  const pad2 = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}T${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}:${pad2(d.getUTCSeconds())}+${pad2(offsetHours)}:00`;
}

/** 将值安全转换为 Date 或 null */
export function parseDateTimeLike(v: unknown): Date | null {
  if (v instanceof Date) return v;
  if (typeof v === 'number' && Number.isFinite(v)) {
    const normalizedMs = v > 100000000000 ? v : v * 1000;
    const d = new Date(normalizedMs);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  if (typeof v === 'string') {
    const n = Number(v);
    if (Number.isFinite(n)) {
      const normalizedMs = n > 100000000000 ? n : n * 1000;
      const d = new Date(normalizedMs);
      return Number.isNaN(d.getTime()) ? null : d;
    }
    const t = Date.parse(v);
    if (Number.isFinite(t)) return new Date(t);
  }
  return null;
}

/** 将天数限制在合理范围内 */
export function clampDays(days: number, min: number = 1, max: number = 730): number {
  if (!Number.isFinite(days)) return min;
  return Math.max(min, Math.min(max, Math.trunc(days)));
}
