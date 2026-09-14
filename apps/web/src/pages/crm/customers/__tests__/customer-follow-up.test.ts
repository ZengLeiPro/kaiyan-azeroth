import { describe, expect, it } from 'vitest';

import { isCustomerFollowUpOverdue } from '../customer-follow-up';

describe('客户回访自然日判断', () => {
  const now = new Date(2026, 8, 8, 12);

  it.each(['2026-09-08', '2026-09-08T00:00:00.000Z'])('今日回访 %s 尚未逾期', (nextFollowUpAt) => {
    expect(isCustomerFollowUpOverdue({ nextFollowUpAt, lastKeepRecordTime: null }, now)).toBe(
      false
    );
    expect(
      isCustomerFollowUpOverdue(
        { nextFollowUpAt, lastKeepRecordTime: null },
        new Date(2026, 8, 8, 23, 59, 59)
      )
    ).toBe(false);
  });

  it.each(['2026-09-07', '2026-09-07T00:00:00.000Z'])(
    '兼容纯日期与旧完整ISO：%s',
    (nextFollowUpAt) => {
      expect(
        isCustomerFollowUpOverdue(
          { nextFollowUpAt, lastKeepRecordTime: new Date(2026, 8, 6, 12).toISOString() },
          now
        )
      ).toBe(true);
      expect(
        isCustomerFollowUpOverdue(
          { nextFollowUpAt, lastKeepRecordTime: new Date(2026, 8, 8, 10).toISOString() },
          now
        )
      ).toBe(false);
    }
  );

  it('没有回访日期或尚未到期不标记，昨日到期且没有跟进则标记', () => {
    expect(isCustomerFollowUpOverdue({ nextFollowUpAt: null, lastKeepRecordTime: null }, now)).toBe(
      false
    );
    expect(
      isCustomerFollowUpOverdue({ nextFollowUpAt: '2026-09-09', lastKeepRecordTime: null }, now)
    ).toBe(false);
    expect(
      isCustomerFollowUpOverdue({ nextFollowUpAt: '2026-09-07', lastKeepRecordTime: null }, now)
    ).toBe(true);
  });
});
