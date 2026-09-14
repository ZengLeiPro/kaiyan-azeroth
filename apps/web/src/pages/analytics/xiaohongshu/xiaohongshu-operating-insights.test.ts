import type {
  IXiaohongshuMetrics,
  IXiaohongshuSummaryResponse,
  IXiaohongshuTrendResponse,
} from '@ky-azeroth/shared/types';
import { describe, expect, it } from 'vitest';

import {
  buildXiaohongshuOperatingSignals,
  buildXiaohongshuTrendSeries,
} from './xiaohongshu-operating-insights';

const coverage = {
  landingPageVisit: 'full',
  formImpression: 'full',
  formSubmit: 'full',
  validFormSubmit: 'full',
  combinedLead: 'unavailable',
  messageUser: 'full',
  messageConsult: 'full',
  messageOpen: 'full',
  messageLead: 'full',
} as const;

function metrics(overrides: Partial<IXiaohongshuMetrics> = {}): IXiaohongshuMetrics {
  return {
    fee: 493.65,
    impression: 8539,
    click: 1199,
    interaction: 53,
    like: 21,
    comment: 0,
    collect: 21,
    follow: 7,
    share: 4,
    messageConsult: 4,
    messageLead: 1,
    formSubmit: 0,
    metricCoverage: coverage,
    ...overrides,
  };
}

describe('小红书经营提示与趋势序列', () => {
  it('识别增投未传到咨询、咨询转化走弱和小样本', () => {
    const data = {
      totals: metrics(),
      comparison: {
        range: { startDate: '2026-07-01', endDate: '2026-07-30', dataCaliber: 0 },
        totals: metrics({ fee: 315.77, click: 266, messageConsult: 5, messageLead: 0 }),
      },
      deltas: {
        fee: { current: 493.65, previous: 315.77, changeRate: 0.563 },
        messageConsult: { current: 4, previous: 5, changeRate: -0.2 },
      },
    } as IXiaohongshuSummaryResponse;

    expect(buildXiaohongshuOperatingSignals(data).map((item) => item.title)).toEqual([
      '增投没有传到咨询',
      '点击增加，但咨询转化走弱',
      '获客样本仍小',
    ]);
  });

  it('覆盖不可用时不把转化字段当作真实 0', () => {
    const data = {
      totals: metrics({
        messageConsult: 0,
        formSubmit: 0,
        metricCoverage: { ...coverage, messageConsult: 'unavailable', formSubmit: 'unavailable' },
      }),
    } as IXiaohongshuSummaryResponse;

    expect(buildXiaohongshuOperatingSignals(data)).toEqual([
      expect.objectContaining({ title: '本期未触发确定性经营提示' }),
    ]);
  });

  it('补齐缺失日期但保留真实零，避免折线跨过同步断档', () => {
    const data = {
      range: { startDate: '2026-08-01', endDate: '2026-08-03', dataCaliber: 0 },
      level: 'account',
      points: [
        { ...metrics({ fee: 10, click: 0 }), date: '2026-08-01' },
        { ...metrics({ fee: 20, click: 2 }), date: '2026-08-03' },
      ],
    } as IXiaohongshuTrendResponse;

    const result = buildXiaohongshuTrendSeries(data);
    expect(result.map((item) => item.date)).toEqual(['2026-08-01', '2026-08-02', '2026-08-03']);
    expect(result[0]?.click).toBe(0);
    expect(result[1]).toEqual(expect.objectContaining({ fee: null, click: null }));
  });
});
