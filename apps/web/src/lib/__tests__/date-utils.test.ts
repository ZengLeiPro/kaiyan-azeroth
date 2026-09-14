import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  extractDatePart,
  formatDateDisplay,
  formatDateTimeDisplay,
  formatDateToLocalDateString,
  getDateAfterYearsString,
  getNowDateTimeLocalString,
  getTodayDateString,
  isoToLocalInput,
  localInputToIso,
  parseLocalDateString,
} from '../date-utils';

describe('date-utils', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('extractDatePart 兼容 ISO、纯日期和空值', () => {
    expect(extractDatePart('2026-06-25T08:30:00.000Z')).toBe('2026-06-25');
    expect(extractDatePart('2026-06-25')).toBe('2026-06-25');
    expect(extractDatePart(null)).toBe('');
    expect(extractDatePart(undefined)).toBe('');
  });

  it('formatDateDisplay 支持常用展示格式', () => {
    expect(formatDateDisplay('2026-06-25T08:30:00.000Z')).toBe('2026-06-25');
    expect(formatDateDisplay('2026-06-25', 'YYYY/MM/DD')).toBe('2026/06/25');
    expect(formatDateDisplay('2026-06-25', 'MM-DD')).toBe('06-25');
    expect(formatDateDisplay(null)).toBe('');
  });

  it('formatDateTimeDisplay 按本地时区精确到分钟', () => {
    expect(formatDateTimeDisplay(null)).toBe('');
    expect(formatDateTimeDisplay(undefined)).toBe('');
    expect(formatDateTimeDisplay('not-a-date')).toBe('');

    const local = new Date(2026, 5, 25, 9, 8, 30);
    expect(formatDateTimeDisplay(local)).toBe('2026-06-25 09:08');

    const utcIso = '2026-06-25T01:08:00.000Z';
    const expected = formatDateTimeDisplay(new Date(utcIso));
    expect(formatDateTimeDisplay(utcIso)).toBe(expected);
    expect(expected).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
  });

  it('formatDateToLocalDateString 与 parseLocalDateString 按本地日期互转', () => {
    const date = new Date(2026, 5, 25, 23, 59);
    expect(formatDateToLocalDateString(date)).toBe('2026-06-25');
    expect(formatDateToLocalDateString(new Date(Number.NaN))).toBe('');

    const parsed = parseLocalDateString('2026-06-25T00:00:00.000Z');
    expect(parsed?.getFullYear()).toBe(2026);
    expect(parsed?.getMonth()).toBe(5);
    expect(parsed?.getDate()).toBe(25);
    expect(parseLocalDateString('bad-date')).toBeUndefined();
  });

  it('当前日期/日期时间函数使用本地时间而非 UTC 截断', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 5, 25, 9, 8));

    expect(getTodayDateString()).toBe('2026-06-25');
    expect(getNowDateTimeLocalString()).toBe('2026-06-25T09:08');
    expect(getDateAfterYearsString(1)).toBe('2027-06-25');
  });

  it('datetime-local 与 ISO 互转时处理非法输入', () => {
    expect(isoToLocalInput(null)).toBe('');
    expect(isoToLocalInput('not-a-date')).toBe('');
    expect(localInputToIso(null)).toBeNull();
    expect(localInputToIso('not-a-date')).toBeNull();

    const iso = localInputToIso('2026-06-25T09:08');
    expect(iso).toBe(new Date('2026-06-25T09:08').toISOString());

    const utcIso = '2026-06-25T09:08:00.000Z';
    expect(localInputToIso(isoToLocalInput(utcIso))).toBe(utcIso);
  });
});
