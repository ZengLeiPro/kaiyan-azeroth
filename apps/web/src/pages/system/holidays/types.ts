import type {
  HolidayItem,
  HolidayListResponse,
  HolidayResponse,
  HolidayType,
  HolidayYearResponse,
} from '@ky-azeroth/shared/schemas';

export type { HolidayItem, HolidayListResponse, HolidayResponse, HolidayType, HolidayYearResponse };

/**
 * 前端 draft：key 为 YYYY-MM-DD，value 为该日期的「例外」声明。
 * 不在 map 里 = 沿用默认规则（工作日上班 / 周末休息）。
 */
export type HolidayDraftMap = Map<string, HolidayItem>;

/**
 * 单元格在 UI 中的视觉状态
 */
export type CellState = 'default-workday' | 'default-weekend' | 'holiday' | 'workday-makeup';

/**
 * 把字符串 ISO yyyy-mm-dd 转为本地 Date（午夜 0 点）
 */
export function fromIso(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y!, (m ?? 1) - 1, d ?? 1);
}

/**
 * 把 Date 转为 YYYY-MM-DD（本地时区视角）
 */
export function toIso(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function isWeekend(date: Date): boolean {
  const dow = date.getDay();
  return dow === 0 || dow === 6;
}

export function itemsToMap(items: HolidayResponse[]): HolidayDraftMap {
  const map: HolidayDraftMap = new Map();
  for (const item of items) {
    map.set(item.date, {
      date: item.date,
      type: item.type,
      note: item.note ?? null,
    });
  }
  return map;
}

/**
 * 点击切换（只暴露「打破默认规则」的状态，避免冗余中间态）：
 *   工作日：默认 → HOLIDAY（法定节假日） → 默认
 *   周末  ：默认 → WORKDAY（调休补班）   → 默认
 *
 * 工作日 + WORKDAY、周末 + HOLIDAY 在 isRestDay 语义上与「不打标记」完全等价，
 * 故不在循环中暴露。复制上一年若产生 dow 错位的冗余记录，由用户手动清除。
 */
export function cycleCellState(date: Date, current: HolidayItem | undefined): HolidayItem | null {
  if (!current) {
    return {
      date: toIso(date),
      type: isWeekend(date) ? 'WORKDAY' : 'HOLIDAY',
      note: null,
    };
  }
  return null;
}
