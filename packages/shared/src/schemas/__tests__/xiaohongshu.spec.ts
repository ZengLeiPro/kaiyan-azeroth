import { describe, expect, it } from 'vitest';

import {
  xiaohongshuDailyReportQuerySchema,
  xiaohongshuDatasetCatalogQuerySchema,
  xiaohongshuDatasetIdSchema,
  xiaohongshuDatasetQuerySchema,
  xiaohongshuManualSyncBodySchema,
  xiaohongshuRankingQuerySchema,
  xiaohongshuSummaryQuerySchema,
  xiaohongshuTrendQuerySchema,
} from '../xiaohongshu';

describe('xiaohongshu schemas', () => {
  it('手动同步默认包含笔记在内的五个报表层级', () => {
    expect(xiaohongshuManualSyncBodySchema.parse({}).levels).toEqual([
      'account',
      'campaign',
      'unit',
      'creative',
      'note',
    ]);
  });

  it('日报、手动同步与排行查询均接受 note 层级', () => {
    expect(xiaohongshuDailyReportQuerySchema.parse({ level: 'note' }).level).toBe('note');
    expect(xiaohongshuManualSyncBodySchema.parse({ levels: ['note'] }).levels).toEqual(['note']);
    expect(
      xiaohongshuRankingQuerySchema.parse({
        startDate: '2026-08-01',
        endDate: '2026-08-20',
        level: 'note',
      }).level
    ).toBe('note');
  });

  it('拒绝倒序日期范围', () => {
    expect(() =>
      xiaohongshuManualSyncBodySchema.parse({
        startDate: '2026-08-21',
        endDate: '2026-08-20',
      })
    ).toThrow(/startDate/);
  });

  it.each([
    xiaohongshuDailyReportQuerySchema,
    xiaohongshuSummaryQuerySchema,
    xiaohongshuTrendQuerySchema,
  ])('日报与分析查询默认使用 0 口径并接受字符串 1', (schema) => {
    const base =
      schema === xiaohongshuDailyReportQuerySchema
        ? {}
        : { startDate: '2026-08-01', endDate: '2026-08-20' };
    expect(schema.parse(base).dataCaliber).toBe(0);
    expect(schema.parse({ ...base, dataCaliber: '1' }).dataCaliber).toBe(1);
    expect(() => schema.parse({ ...base, dataCaliber: 2 })).toThrow();
  });

  it('summary 对比日期必须成对且有序', () => {
    const base = { startDate: '2026-08-01', endDate: '2026-08-20' };
    expect(() =>
      xiaohongshuSummaryQuerySchema.parse({ ...base, compareStartDate: '2026-07-01' })
    ).toThrow(/compareStartDate/);
    expect(() =>
      xiaohongshuSummaryQuerySchema.parse({
        ...base,
        compareStartDate: '2026-07-20',
        compareEndDate: '2026-07-01',
      })
    ).toThrow(/compareStartDate/);
    expect(
      xiaohongshuSummaryQuerySchema.parse({
        ...base,
        compareStartDate: '2026-07-01',
        compareEndDate: '2026-07-20',
      })
    ).toEqual(expect.objectContaining({ compareStartDate: '2026-07-01' }));
  });

  it.each(['interaction', 'messageConsult', 'messageLead', 'formSubmit', 'validFormSubmit'])(
    '排行支持扩展指标 %s',
    (metric) => {
      const parsed = xiaohongshuRankingQuerySchema.parse({
        startDate: '2026-08-01',
        endDate: '2026-08-20',
        level: 'campaign',
        limit: '50',
        metric,
        dataCaliber: '1',
      });
      expect(parsed).toEqual(expect.objectContaining({ limit: 50, metric, dataCaliber: 1 }));
    }
  );

  it('排行限制条数', () => {
    expect(() =>
      xiaohongshuRankingQuerySchema.parse({
        startDate: '2026-08-01',
        endDate: '2026-08-20',
        level: 'campaign',
        limit: 101,
      })
    ).toThrow();
  });

  it('数据集查询接受嵌套参数，并严格限制分页与成对日期范围', () => {
    expect(
      xiaohongshuDatasetQuerySchema.parse({
        advertiserId: 'adv-1',
        page: '2',
        params: { note_ids: ['note-1'], target_config: { age: [18, 35] } },
      })
    ).toEqual(
      expect.objectContaining({
        advertiserId: 'adv-1',
        page: 2,
        pageSize: 50,
        params: { note_ids: ['note-1'], target_config: { age: [18, 35] } },
      })
    );
    expect(() =>
      xiaohongshuDatasetQuerySchema.parse({ advertiserId: 'adv-1', pageSize: 101 })
    ).toThrow();
    expect(() =>
      xiaohongshuDatasetQuerySchema.parse({ advertiserId: 'adv-1', forged: true })
    ).toThrow();
    expect(() =>
      xiaohongshuDatasetQuerySchema.parse({
        advertiserId: 'adv-1',
        startDate: '2026-08-29',
        endDate: '2026-08-01',
      })
    ).toThrow(/startDate/);
    expect(() =>
      xiaohongshuDatasetQuerySchema.parse({
        advertiserId: 'adv-1',
        startDate: '2026-08-01',
      })
    ).toThrow(/必须同时提供/);
  });

  it('数据集标识只接受 registry 使用的小写点分/连字符格式', () => {
    expect(xiaohongshuDatasetIdSchema.parse('report.keyword-offline')).toBe(
      'report.keyword-offline'
    );
    expect(() => xiaohongshuDatasetIdSchema.parse('../connection')).toThrow();
    expect(() => xiaohongshuDatasetIdSchema.parse('Report.Keyword')).toThrow();
  });

  it('数据目录按选中广告主解析授权，并拒绝空广告主 ID', () => {
    expect(xiaohongshuDatasetCatalogQuerySchema.parse({ advertiserId: 'adv-1' })).toEqual({
      advertiserId: 'adv-1',
    });
    expect(() => xiaohongshuDatasetCatalogQuerySchema.parse({ advertiserId: ' ' })).toThrow();
  });
});
