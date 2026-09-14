import { describe, expect, it } from 'vitest';

import { normalizeDingtalkCalendarEvent } from '../calendar';

describe('normalizeDingtalkCalendarEvent (SYS-CAL fix)', () => {
  const base = {
    id: 'evt-1',
    summary: '测试日程',
    description: '描述',
    start: { dateTime: '2026-06-13T10:00:00+08:00' },
    end: { dateTime: '2026-06-13T11:00:00+08:00' },
    attendees: [],
    status: 'confirmed',
    updateTime: '2026-06-13T09:00:00+08:00',
  };

  it('location 有 displayName：照常取', () => {
    const parsed = normalizeDingtalkCalendarEvent({
      ...base,
      location: { displayName: '深圳会议室 A' },
    });
    expect(parsed.location).toBe('深圳会议室 A');
  });

  it('location 仅 address（无 displayName）：回退到 address', () => {
    const parsed = normalizeDingtalkCalendarEvent({
      ...base,
      location: { address: '深南大道 1234 号' },
    });
    expect(parsed.location).toBe('深南大道 1234 号');
  });

  it('location 是空对象 {}：绝不落 [object Object]，应为空串', () => {
    const parsed = normalizeDingtalkCalendarEvent({ ...base, location: {} });
    expect(parsed.location).toBe('');
    expect(parsed.location).not.toContain('object Object');
  });

  it('location 缺失：应为空串', () => {
    const parsed = normalizeDingtalkCalendarEvent({ ...base });
    expect(parsed.location).toBe('');
  });

  it('creator displayName 取值', () => {
    const parsed = normalizeDingtalkCalendarEvent({
      ...base,
      organizer: { displayName: '张三' },
    });
    expect(parsed.creator).toBe('张三');
  });

  it('creator 空对象：不落 [object Object]', () => {
    const parsed = normalizeDingtalkCalendarEvent({ ...base, organizer: {}, creator: {} });
    expect(parsed.creator).toBe('');
    expect(parsed.creator).not.toContain('object Object');
  });
});
