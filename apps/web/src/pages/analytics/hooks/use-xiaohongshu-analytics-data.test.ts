import { describe, expect, it } from 'vitest';

import {
  buildXiaohongshuAnalyticsParams,
  buildXiaohongshuRankingParams,
  buildXiaohongshuReportsParams,
  buildXiaohongshuSummaryParams,
  resolvePreviousXiaohongshuRange,
  resolveXiaohongshuRange,
} from './use-xiaohongshu-analytics-data';

describe('resolveXiaohongshuRange', () => {
  const now = new Date(2026, 7, 22, 10, 0, 0);

  it('近 30 天按 T-1 截止', () => {
    expect(resolveXiaohongshuRange({ preset: 'last30d' }, now)).toEqual({
      startDate: '2026-07-23',
      endDate: '2026-08-21',
    });
  });

  it('本月至今不包含当天', () => {
    expect(resolveXiaohongshuRange({ preset: 'mtd' }, now)).toEqual({
      startDate: '2026-08-01',
      endDate: '2026-08-21',
    });
  });

  it('自定义日期保持用户选择', () => {
    expect(
      resolveXiaohongshuRange(
        { preset: 'custom', startDate: '2026-08-10', endDate: '2026-08-15' },
        now
      )
    ).toEqual({ startDate: '2026-08-10', endDate: '2026-08-15' });
  });
});

describe('resolvePreviousXiaohongshuRange', () => {
  it('以前一日为结束日，并按含首尾天数等长回溯', () => {
    expect(
      resolvePreviousXiaohongshuRange({ startDate: '2026-08-10', endDate: '2026-08-15' })
    ).toEqual({ startDate: '2026-08-04', endDate: '2026-08-09' });
  });

  it('跨月和跨年仍保持等长', () => {
    expect(
      resolvePreviousXiaohongshuRange({ startDate: '2026-01-01', endDate: '2026-01-03' })
    ).toEqual({ startDate: '2025-12-29', endDate: '2025-12-31' });
  });
});

describe('小红书 analytics 请求参数', () => {
  const range = {
    preset: 'custom' as const,
    startDate: '2026-08-10',
    endDate: '2026-08-15',
  };

  it('summary 默认携带数据口径和上一等长周期', () => {
    expect(buildXiaohongshuSummaryParams(range, 1, 'adv-1')).toEqual({
      startDate: '2026-08-10',
      endDate: '2026-08-15',
      compareStartDate: '2026-08-04',
      compareEndDate: '2026-08-09',
      advertiserId: 'adv-1',
      level: 'account',
      dataCaliber: 1,
    });
  });

  it('trend 参数携带数据口径且清理空广告主', () => {
    expect(buildXiaohongshuAnalyticsParams(range, 0, '')).toEqual({
      startDate: '2026-08-10',
      endDate: '2026-08-15',
      advertiserId: undefined,
      level: 'account',
      dataCaliber: 0,
    });
  });

  it('ranking 固定使用笔记层级并保留指标', () => {
    expect(buildXiaohongshuRankingParams(range, 'click', 1, 'adv-1')).toEqual({
      startDate: '2026-08-10',
      endDate: '2026-08-15',
      advertiserId: 'adv-1',
      level: 'note',
      metric: 'click',
      dataCaliber: 1,
      limit: 10,
    });
  });

  it('reports 固定使用笔记层级并携带服务端分页', () => {
    expect(buildXiaohongshuReportsParams(range, 1, 'adv-1', 3, 100)).toEqual({
      startDate: '2026-08-10',
      endDate: '2026-08-15',
      advertiserId: 'adv-1',
      level: 'note',
      dataCaliber: 1,
      page: 3,
      pageSize: 100,
    });
  });
});
