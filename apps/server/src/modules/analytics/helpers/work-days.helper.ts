/**
 * 工作日数粗算（5/7 估算）
 *
 * 用户确认（2026-05-17）：维持与 effort-records/effort-stats.service.ts:17 同口径
 *   workDays = round(totalDays × 5/7)
 * 不扣节假日、不扣请假。M1 一致性优先于精准度。
 *
 * 后续如要升级到节假日表方案，仅替换此 helper 即可。
 */

/**
 * 列出闭区间内所有「周一到周五」日期（YYYY-MM-DD）
 *
 * 与 effort-stats.service.ts:317-326 同口径，供日报/工时填报完成度计算使用。
 */
export function listWorkDays(start: Date, end: Date): string[] {
  const out: string[] = [];
  const cur = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  const last = new Date(end.getFullYear(), end.getMonth(), end.getDate());
  while (cur <= last) {
    const day = cur.getDay();
    if (day !== 0 && day !== 6) {
      const y = cur.getFullYear();
      const m = String(cur.getMonth() + 1).padStart(2, '0');
      const d = String(cur.getDate()).padStart(2, '0');
      out.push(`${y}-${m}-${d}`);
    }
    cur.setDate(cur.getDate() + 1);
  }
  return out;
}
