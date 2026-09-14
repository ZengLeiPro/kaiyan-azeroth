import type { IXiaohongshuDailyReport, IXiaohongshuMetrics } from '@ky-azeroth/shared/types';
import { describe, expect, it } from 'vitest';

import {
  buildXiaohongshuFunnelStages,
  formatXiaohongshuDeltaHint,
  formatXiaohongshuFunnelCost,
  formatXiaohongshuFunnelRate,
  formatXiaohongshuReportValue,
  getSafeXiaohongshuHttpUrl,
  getSafeXiaohongshuImageUrl,
  getXiaohongshuReportDataColumns,
  getXiaohongshuReportObjectName,
  getXiaohongshuReportPageCoverage,
} from './xiaohongshu-analytics-page-utils';

describe('XiaohongshuAnalyticsPage helpers', () => {
  it('上一周期为 0 时不伪造环比比例', () => {
    const hint = formatXiaohongshuDeltaHint({ current: 12, previous: 0, changeRate: null });
    expect(hint).toBe('上一等长周期无可比数据');
    expect(hint).not.toContain('%');
  });

  it('部分覆盖与真实环比同时提示', () => {
    expect(
      formatXiaohongshuDeltaHint({ current: 120, previous: 100, changeRate: 0.2 }, 'partial')
    ).toBe('部分覆盖 · 环比 +20.0%');
  });

  it('不可用覆盖率优先显示不可用，不展示数值变化', () => {
    expect(
      formatXiaohongshuDeltaHint({ current: 12, previous: 10, changeRate: 0.2 }, 'unavailable')
    ).toBe('指标暂不可用');
  });

  it('按阶段映射漏斗转化率与关键 CPL', () => {
    const totals = {
      messageUser: 200,
      messageConsult: 80,
      messageConsultRate: 0.4,
      messageConsultCost: 12.5,
      messageOpen: 40,
      messageOpenRate: 0.5,
      messageLead: 10,
      messageLeadRate: 0.25,
      messageLeadCost: 100,
      landingPageVisit: 500,
      landingPageVisitRate: 0.2,
      formImpression: 250,
      formImpressionRate: 0.5,
      formSubmit: 50,
      formSubmitRate: 0.2,
      formSubmitCost: 20,
      validFormSubmit: 25,
      validFormSubmitRate: 0.5,
      validFormSubmitCost: 40,
      metricCoverage: {
        landingPageVisit: 'full',
        formImpression: 'full',
        formSubmit: 'full',
        validFormSubmit: 'full',
        combinedLead: 'unavailable',
        messageUser: 'full',
        messageConsult: 'full',
        messageOpen: 'full',
        messageLead: 'full',
      },
    } as IXiaohongshuMetrics;

    const { messageStages, formStages } = buildXiaohongshuFunnelStages(totals);

    expect(messageStages.map(({ label, rate, cost }) => ({ label, rate, cost }))).toEqual([
      { label: '私信用户', rate: undefined, cost: undefined },
      { label: '私信咨询', rate: 0.4, cost: 12.5 },
      { label: '私信开口', rate: 0.5, cost: undefined },
      { label: '私信留资', rate: 0.25, cost: 100 },
    ]);
    expect(formStages.map(({ label, rate, cost }) => ({ label, rate, cost }))).toEqual([
      { label: '落地页访问', rate: 0.2, cost: undefined },
      { label: '表单曝光', rate: 0.5, cost: undefined },
      { label: '表单提交', rate: 0.2, cost: 20 },
      { label: '有效表单', rate: 0.5, cost: 40 },
    ]);
    expect(messageStages[1]?.rateLabel).toBe('相对点击转化率');
    expect(formStages[0]?.rateLabel).toBe('相对点击率');
  });

  it('仅按当前页日报值分别计算转化指标 coverage', () => {
    const reports = [
      {
        messageConsult: null,
        messageLead: 0,
        formSubmit: 3,
        validFormSubmit: undefined,
      },
      {
        messageConsult: undefined,
        messageLead: 2,
        formSubmit: null,
        validFormSubmit: 1,
      },
    ] as IXiaohongshuDailyReport[];

    expect(getXiaohongshuReportPageCoverage(reports)).toEqual({
      messageConsult: 'unavailable',
      messageLead: 'full',
      formSubmit: 'partial',
      validFormSubmit: 'partial',
    });
    expect(getXiaohongshuReportPageCoverage([])).toEqual({
      messageConsult: 'unavailable',
      messageLead: 'unavailable',
      formSubmit: 'unavailable',
      validFormSubmit: 'unavailable',
    });
  });

  it('漏斗未知值显示短横线而不伪造 0', () => {
    expect(formatXiaohongshuFunnelRate(undefined)).toBe('-');
    expect(formatXiaohongshuFunnelRate(null)).toBe('-');
    expect(formatXiaohongshuFunnelCost(undefined)).toBe('-');
    expect(formatXiaohongshuFunnelCost(null)).toBe('-');
    expect(formatXiaohongshuFunnelRate('')).toBe('-');
    expect(formatXiaohongshuFunnelCost(' ')).toBe('-');
    expect(formatXiaohongshuFunnelRate(0)).toBe('0.00%');
    expect(formatXiaohongshuFunnelCost(0)).toBe('¥0.00');
  });

  it('不可用阶段同时隐藏数量、转化率与 CPL', () => {
    const totals = {
      messageConsult: 12,
      messageConsultRate: 0.3,
      messageConsultCost: 50,
      metricCoverage: {
        messageConsult: 'unavailable',
      },
    } as IXiaohongshuMetrics;

    const { messageStages } = buildXiaohongshuFunnelStages(totals);

    expect(messageStages[1]).toMatchObject({
      label: '私信咨询',
      value: null,
      rate: null,
      cost: null,
      coverage: 'unavailable',
    });
  });

  it('日报对象按当前层级选择名称，并回退到 ID', () => {
    const report = {
      advertiserId: 'adv-1',
      campaignId: 'campaign-1',
      campaignName: '种草计划',
      unitId: 'unit-1',
      creativeId: 'creative-1',
    } as IXiaohongshuDailyReport;

    expect(getXiaohongshuReportObjectName(report, 'campaign')).toBe('种草计划');
    expect(getXiaohongshuReportObjectName(report, 'unit')).toBe('unit-1');
    expect(getXiaohongshuReportObjectName(report, 'creative')).toBe('creative-1');
    expect(getXiaohongshuReportObjectName({ ...report, noteTitle: '真实标题' }, 'note')).toBe(
      '真实标题'
    );
  });

  it('raw 列按当前页求并集，固定字段去重并按业务分组稳定排序', () => {
    const baseReport: IXiaohongshuDailyReport = {
      id: 'report-1',
      statDate: '2026-08-20',
      advertiserId: 'adv-1',
      level: 'note',
      dataCaliber: 0,
      rawPayload: {},
      fee: 0,
      impression: 0,
      click: 0,
      interaction: 0,
      like: 0,
      comment: 0,
      collect: 0,
      follow: 0,
      share: 0,
    };
    const reports: IXiaohongshuDailyReport[] = [
      {
        ...baseReport,
        rawPayload: {
          note_id: 'note-1',
          note_title: '标题',
          note_image: 'https://example.com/cover.jpg',
          note_jump_url: 'https://example.com/note-1',
          time: '2026-08-20',
          impression: 100,
          video_play_3s: 12,
          content_type: '图文',
          note_meta__title: '已在笔记卡片展示',
          note_meta__author: '作者甲',
          note_meta__custom_field: '扩展值',
          z_unknown: true,
        },
      },
      {
        ...baseReport,
        id: 'report-2',
        rawPayload: {
          a_unknown: { foo: 1 },
          product_click: 3,
          message_consult: 2,
        },
      },
    ];

    const columns = getXiaohongshuReportDataColumns(reports);
    const rawColumns = columns.filter((column) => column.source === 'raw');

    expect(rawColumns.map(({ key, label, group }) => ({ key, label, group }))).toEqual([
      { key: 'content_type', label: '内容类型', group: '内容' },
      { key: 'note_meta__author', label: '作者', group: '内容' },
      {
        key: 'note_meta__custom_field',
        label: '笔记元数据·其他字段（custom_field）',
        group: '内容',
      },
      { key: 'impression', label: '曝光', group: '投放' },
      { key: 'video_play_3s', label: '3秒播放', group: '视频' },
      { key: 'message_consult', label: '私信咨询', group: '私信' },
      { key: 'product_click', label: '商品点击', group: '电商' },
      { key: 'a_unknown', label: '其他字段（a_unknown）', group: '其他' },
      { key: 'z_unknown', label: '其他字段（z_unknown）', group: '其他' },
    ]);
    expect(rawColumns.map((column) => column.key)).not.toEqual(
      expect.arrayContaining([
        'note_id',
        'note_title',
        'note_image',
        'note_jump_url',
        'note_meta__title',
        'time',
      ])
    );
    expect(columns.find((column) => column.key === 'advertiserId')?.label).toBe('广告主标识（ID）');
    expect(columns.find((column) => column.key === 'messageConsult')?.group).toBe('私信');
  });

  it('服务端完整字段集合可补齐当前页没有出现的稀疏列', () => {
    const columns = getXiaohongshuReportDataColumns(
      [],
      ['note_meta__desc', 'message_consult', 'future_metric']
    );

    expect(columns).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: 'note_meta__desc', label: '正文', group: '内容' }),
        expect.objectContaining({ key: 'message_consult', label: '私信咨询', group: '私信' }),
        expect.objectContaining({
          key: 'future_metric',
          label: '其他字段（future_metric）',
          group: '其他',
        }),
      ])
    );
  });

  it('原始值保持字符串百分比并格式化 null、布尔和复合值', () => {
    expect(formatXiaohongshuReportValue(null)).toBe('-');
    expect(formatXiaohongshuReportValue(true)).toBe('是');
    expect(formatXiaohongshuReportValue(false)).toBe('否');
    expect(formatXiaohongshuReportValue('12.5%')).toBe('12.5%');
    expect(formatXiaohongshuReportValue([1, 'a'])).toBe('[1,"a"]');
    expect(formatXiaohongshuReportValue({ count: 1 })).toBe('{"数量":1}');
  });

  it('将 HTTP 封面升级为 HTTPS，避免安全页面拦截混合内容', () => {
    expect(getSafeXiaohongshuImageUrl('http://ci.xiaohongshu.com/cover.jpg?width=1080')).toBe(
      'https://ci.xiaohongshu.com/cover.jpg?width=1080'
    );
    expect(getSafeXiaohongshuImageUrl('https://ci.xiaohongshu.com/cover.jpg')).toBe(
      'https://ci.xiaohongshu.com/cover.jpg'
    );
    expect(getSafeXiaohongshuImageUrl('javascript:alert(1)')).toBeNull();
  });

  it('只允许无凭据的 http(s) 笔记链接', () => {
    expect(getSafeXiaohongshuHttpUrl('https://www.xiaohongshu.com/explore/1')).toBe(
      'https://www.xiaohongshu.com/explore/1'
    );
    expect(getSafeXiaohongshuHttpUrl('http://example.com/note')).toBe('http://example.com/note');
    expect(getSafeXiaohongshuHttpUrl('javascript:alert(1)')).toBeNull();
    expect(getSafeXiaohongshuHttpUrl('https://user:secret@example.com/note')).toBeNull();
    expect(getSafeXiaohongshuHttpUrl('not-a-url')).toBeNull();
  });
});
