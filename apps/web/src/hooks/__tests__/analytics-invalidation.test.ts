import { describe, expect, it } from 'vitest';

import {
  getAnalyticsInvalidationKeys,
  invalidateAnalyticsQueries,
} from '../analytics-invalidation';

describe('getAnalyticsInvalidationKeys', () => {
  it('CRM 写操作精确失效总览与 CRM 经营盘', () => {
    expect(getAnalyticsInvalidationKeys('/payments')).toEqual([
      ['analytics', 'overview'],
      ['analytics', 'crm'],
    ]);
  });

  it('工时写操作同时失效交付盘与组织效率盘', () => {
    expect(getAnalyticsInvalidationKeys('/effort-records?scope=mine')).toEqual([
      ['analytics', 'overview'],
      ['analytics', 'projects'],
      ['analytics', 'organization'],
    ]);
  });

  it('未知端点不扩大失效范围', () => {
    expect(getAnalyticsInvalidationKeys('/notifications')).toEqual([]);
  });

  it('统一失效 helper 等待所有相关经营分析查询', async () => {
    const invalidated: unknown[] = [];

    await invalidateAnalyticsQueries(
      {
        invalidateQueries: async (filters) => {
          invalidated.push(filters?.queryKey);
        },
      },
      '/project-tickets/'
    );

    expect(invalidated).toEqual([
      ['analytics', 'overview'],
      ['analytics', 'projects'],
    ]);
  });
});
