import type {
  IXiaohongshuDailyReport,
  IXiaohongshuMetricDelta,
  IXiaohongshuMetrics,
  XiaohongshuMetricCoverageStatus,
  XiaohongshuReportLevel,
} from '@ky-azeroth/shared/types';

import {
  formatXiaohongshuDisplayValue,
  getXiaohongshuFieldLabel,
} from './xiaohongshu/xiaohongshu-display';

export interface XiaohongshuFunnelStage {
  label: string;
  value: number | null;
  coverage?: XiaohongshuMetricCoverageStatus;
  rateLabel?: string;
  rate?: unknown;
  costLabel?: string;
  cost?: unknown;
}

export type XiaohongshuReportConversionMetric =
  | 'messageConsult'
  | 'messageLead'
  | 'formSubmit'
  | 'validFormSubmit';

export type XiaohongshuReportPageCoverage = Record<
  XiaohongshuReportConversionMetric,
  XiaohongshuMetricCoverageStatus
>;

function getReportMetricCoverage(
  reports: readonly IXiaohongshuDailyReport[],
  metric: XiaohongshuReportConversionMetric
): XiaohongshuMetricCoverageStatus {
  const availableCount = reports.filter((report) => report[metric] != null).length;
  if (availableCount === 0) return 'unavailable';
  if (availableCount === reports.length) return 'full';
  return 'partial';
}

export function getXiaohongshuReportPageCoverage(
  reports: readonly IXiaohongshuDailyReport[]
): XiaohongshuReportPageCoverage {
  return {
    messageConsult: getReportMetricCoverage(reports, 'messageConsult'),
    messageLead: getReportMetricCoverage(reports, 'messageLead'),
    formSubmit: getReportMetricCoverage(reports, 'formSubmit'),
    validFormSubmit: getReportMetricCoverage(reports, 'validFormSubmit'),
  };
}

function coveredFunnelValue<T>(
  value: T | null | undefined,
  coverage?: XiaohongshuMetricCoverageStatus
): T | null {
  return coverage === 'unavailable' ? null : (value ?? null);
}

export function buildXiaohongshuFunnelStages(totals?: IXiaohongshuMetrics): {
  messageStages: XiaohongshuFunnelStage[];
  formStages: XiaohongshuFunnelStage[];
} {
  const coverage = totals?.metricCoverage;

  return {
    messageStages: [
      {
        label: '私信用户',
        value: coveredFunnelValue(totals?.messageUser, coverage?.messageUser),
        coverage: coverage?.messageUser,
      },
      {
        label: '私信咨询',
        value: coveredFunnelValue(totals?.messageConsult, coverage?.messageConsult),
        coverage: coverage?.messageConsult,
        rateLabel: '相对点击转化率',
        rate: coveredFunnelValue(totals?.messageConsultRate, coverage?.messageConsult),
        costLabel: '单次私信咨询成本',
        cost: coveredFunnelValue(totals?.messageConsultCost, coverage?.messageConsult),
      },
      {
        label: '私信开口',
        value: coveredFunnelValue(totals?.messageOpen, coverage?.messageOpen),
        coverage: coverage?.messageOpen,
        rateLabel: '相对上一阶段转化率',
        rate: coveredFunnelValue(totals?.messageOpenRate, coverage?.messageOpen),
      },
      {
        label: '私信留资',
        value: coveredFunnelValue(totals?.messageLead, coverage?.messageLead),
        coverage: coverage?.messageLead,
        rateLabel: '相对上一阶段转化率',
        rate: coveredFunnelValue(totals?.messageLeadRate, coverage?.messageLead),
        costLabel: '单条私信留资成本',
        cost: coveredFunnelValue(totals?.messageLeadCost, coverage?.messageLead),
      },
    ],
    formStages: [
      {
        label: '落地页访问',
        value: coveredFunnelValue(totals?.landingPageVisit, coverage?.landingPageVisit),
        coverage: coverage?.landingPageVisit,
        rateLabel: '相对点击率',
        rate: coveredFunnelValue(totals?.landingPageVisitRate, coverage?.landingPageVisit),
      },
      {
        label: '表单曝光',
        value: coveredFunnelValue(totals?.formImpression, coverage?.formImpression),
        coverage: coverage?.formImpression,
        rateLabel: '相对上一阶段转化率',
        rate: coveredFunnelValue(totals?.formImpressionRate, coverage?.formImpression),
      },
      {
        label: '表单提交',
        value: coveredFunnelValue(totals?.formSubmit, coverage?.formSubmit),
        coverage: coverage?.formSubmit,
        rateLabel: '相对上一阶段转化率',
        rate: coveredFunnelValue(totals?.formSubmitRate, coverage?.formSubmit),
        costLabel: '单次表单提交成本',
        cost: coveredFunnelValue(totals?.formSubmitCost, coverage?.formSubmit),
      },
      {
        label: '有效表单',
        value: coveredFunnelValue(totals?.validFormSubmit, coverage?.validFormSubmit),
        coverage: coverage?.validFormSubmit,
        rateLabel: '相对上一阶段转化率',
        rate: coveredFunnelValue(totals?.validFormSubmitRate, coverage?.validFormSubmit),
        costLabel: '单条有效表单成本',
        cost: coveredFunnelValue(totals?.validFormSubmitCost, coverage?.validFormSubmit),
      },
    ],
  };
}

export function formatXiaohongshuFunnelRate(value: unknown): string {
  if (value == null || (typeof value === 'string' && value.trim() === '')) return '-';
  const number = Number(value);
  return Number.isFinite(number) ? `${(number * 100).toFixed(2)}%` : '-';
}

export function formatXiaohongshuFunnelCost(value: unknown): string {
  if (value == null || (typeof value === 'string' && value.trim() === '')) return '-';
  const number = Number(value);
  return Number.isFinite(number)
    ? `¥${number.toLocaleString('zh-CN', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })}`
    : '-';
}

export function formatXiaohongshuDeltaHint(
  delta?: IXiaohongshuMetricDelta,
  coverage?: XiaohongshuMetricCoverageStatus
): string | undefined {
  if (coverage === 'unavailable') return '指标暂不可用';
  const parts: string[] = [];
  if (coverage === 'partial') parts.push('部分覆盖');
  if (delta) {
    const previous = Number(delta.previous);
    const rate = delta.changeRate == null ? null : Number(delta.changeRate);
    if (previous === 0 || rate == null || !Number.isFinite(rate)) {
      parts.push('上一等长周期无可比数据');
    } else {
      const sign = rate > 0 ? '+' : '';
      parts.push(`环比 ${sign}${(rate * 100).toFixed(1)}%`);
    }
  }
  return parts.length ? parts.join(' · ') : undefined;
}

export function getXiaohongshuReportObjectName(
  report: IXiaohongshuDailyReport,
  level: XiaohongshuReportLevel
): string {
  if (level === 'note') return report.noteTitle || report.noteId || '-';
  if (level === 'creative') return report.creativeName || report.creativeId || '-';
  if (level === 'unit') return report.unitName || report.unitId || '-';
  if (level === 'campaign') return report.campaignName || report.campaignId || '-';
  return report.advertiserName || report.advertiserId || '-';
}

export const XIAOHONGSHU_REPORT_GROUPS = [
  '内容',
  '投放',
  '互动',
  '视频',
  '线索',
  '私信',
  '电商',
  '其他',
] as const;

export type XiaohongshuReportColumnGroup = (typeof XIAOHONGSHU_REPORT_GROUPS)[number];

export interface XiaohongshuReportDataColumn {
  id: string;
  key: string;
  label: string;
  group: XiaohongshuReportColumnGroup;
  source: 'report' | 'raw';
  order: number;
}

interface RawFieldDefinition {
  label: string;
  group: XiaohongshuReportColumnGroup;
  order: number;
}

const REPORT_FIXED_COLUMNS: readonly XiaohongshuReportDataColumn[] = [
  {
    id: 'report:advertiserId',
    key: 'advertiserId',
    label: '广告主标识（ID）',
    group: '投放',
    source: 'report',
    order: 10,
  },
  {
    id: 'report:advertiserName',
    key: 'advertiserName',
    label: '广告主名称',
    group: '投放',
    source: 'report',
    order: 20,
  },
  {
    id: 'report:campaignId',
    key: 'campaignId',
    label: '计划标识（ID）',
    group: '投放',
    source: 'report',
    order: 30,
  },
  {
    id: 'report:campaignName',
    key: 'campaignName',
    label: '计划名称',
    group: '投放',
    source: 'report',
    order: 40,
  },
  {
    id: 'report:unitId',
    key: 'unitId',
    label: '单元标识（ID）',
    group: '投放',
    source: 'report',
    order: 50,
  },
  {
    id: 'report:unitName',
    key: 'unitName',
    label: '单元名称',
    group: '投放',
    source: 'report',
    order: 60,
  },
  {
    id: 'report:creativeId',
    key: 'creativeId',
    label: '创意标识（ID）',
    group: '投放',
    source: 'report',
    order: 70,
  },
  {
    id: 'report:creativeName',
    key: 'creativeName',
    label: '创意名称',
    group: '投放',
    source: 'report',
    order: 80,
  },
  { id: 'report:fee', key: 'fee', label: '消费', group: '投放', source: 'report', order: 100 },
  {
    id: 'report:impression',
    key: 'impression',
    label: '曝光',
    group: '投放',
    source: 'report',
    order: 110,
  },
  { id: 'report:click', key: 'click', label: '点击', group: '投放', source: 'report', order: 120 },
  { id: 'report:ctr', key: 'ctr', label: '点击率', group: '投放', source: 'report', order: 130 },
  {
    id: 'report:cpc',
    key: 'cpc',
    label: '平均点击成本',
    group: '投放',
    source: 'report',
    order: 140,
  },
  {
    id: 'report:cpm',
    key: 'cpm',
    label: '千次曝光成本',
    group: '投放',
    source: 'report',
    order: 150,
  },
  {
    id: 'report:interaction',
    key: 'interaction',
    label: '互动',
    group: '互动',
    source: 'report',
    order: 10,
  },
  { id: 'report:like', key: 'like', label: '点赞', group: '互动', source: 'report', order: 20 },
  {
    id: 'report:comment',
    key: 'comment',
    label: '评论',
    group: '互动',
    source: 'report',
    order: 30,
  },
  {
    id: 'report:collect',
    key: 'collect',
    label: '收藏',
    group: '互动',
    source: 'report',
    order: 40,
  },
  { id: 'report:follow', key: 'follow', label: '关注', group: '互动', source: 'report', order: 50 },
  { id: 'report:share', key: 'share', label: '分享', group: '互动', source: 'report', order: 60 },
  {
    id: 'report:cpi',
    key: 'cpi',
    label: '单次互动成本',
    group: '互动',
    source: 'report',
    order: 70,
  },
  {
    id: 'report:interactionRate',
    key: 'interactionRate',
    label: '互动率',
    group: '互动',
    source: 'report',
    order: 80,
  },
  {
    id: 'report:likeRate',
    key: 'likeRate',
    label: '点赞率',
    group: '互动',
    source: 'report',
    order: 90,
  },
  {
    id: 'report:collectRate',
    key: 'collectRate',
    label: '收藏率',
    group: '互动',
    source: 'report',
    order: 100,
  },
  {
    id: 'report:commentRate',
    key: 'commentRate',
    label: '评论率',
    group: '互动',
    source: 'report',
    order: 110,
  },
  {
    id: 'report:followRate',
    key: 'followRate',
    label: '关注率',
    group: '互动',
    source: 'report',
    order: 120,
  },
  {
    id: 'report:shareRate',
    key: 'shareRate',
    label: '分享率',
    group: '互动',
    source: 'report',
    order: 130,
  },
  {
    id: 'report:landingPageVisit',
    key: 'landingPageVisit',
    label: '落地页访问',
    group: '线索',
    source: 'report',
    order: 10,
  },
  {
    id: 'report:landingPageVisitRate',
    key: 'landingPageVisitRate',
    label: '落地页访问率',
    group: '线索',
    source: 'report',
    order: 20,
  },
  {
    id: 'report:formImpression',
    key: 'formImpression',
    label: '表单曝光',
    group: '线索',
    source: 'report',
    order: 30,
  },
  {
    id: 'report:formImpressionRate',
    key: 'formImpressionRate',
    label: '表单曝光率',
    group: '线索',
    source: 'report',
    order: 40,
  },
  {
    id: 'report:formSubmit',
    key: 'formSubmit',
    label: '表单提交',
    group: '线索',
    source: 'report',
    order: 50,
  },
  {
    id: 'report:formSubmitRate',
    key: 'formSubmitRate',
    label: '表单提交率',
    group: '线索',
    source: 'report',
    order: 60,
  },
  {
    id: 'report:formSubmitCost',
    key: 'formSubmitCost',
    label: '表单提交成本',
    group: '线索',
    source: 'report',
    order: 70,
  },
  {
    id: 'report:validFormSubmit',
    key: 'validFormSubmit',
    label: '有效表单',
    group: '线索',
    source: 'report',
    order: 80,
  },
  {
    id: 'report:validFormSubmitRate',
    key: 'validFormSubmitRate',
    label: '有效表单率',
    group: '线索',
    source: 'report',
    order: 90,
  },
  {
    id: 'report:validFormSubmitCost',
    key: 'validFormSubmitCost',
    label: '有效表单成本',
    group: '线索',
    source: 'report',
    order: 100,
  },
  {
    id: 'report:combinedLead',
    key: 'combinedLead',
    label: '合并线索',
    group: '线索',
    source: 'report',
    order: 110,
  },
  {
    id: 'report:messageUser',
    key: 'messageUser',
    label: '私信用户',
    group: '私信',
    source: 'report',
    order: 10,
  },
  {
    id: 'report:messageConsult',
    key: 'messageConsult',
    label: '私信咨询',
    group: '私信',
    source: 'report',
    order: 20,
  },
  {
    id: 'report:messageConsultRate',
    key: 'messageConsultRate',
    label: '私信咨询率',
    group: '私信',
    source: 'report',
    order: 30,
  },
  {
    id: 'report:messageConsultCost',
    key: 'messageConsultCost',
    label: '私信咨询成本',
    group: '私信',
    source: 'report',
    order: 40,
  },
  {
    id: 'report:messageOpen',
    key: 'messageOpen',
    label: '私信开口',
    group: '私信',
    source: 'report',
    order: 50,
  },
  {
    id: 'report:messageOpenRate',
    key: 'messageOpenRate',
    label: '私信开口率',
    group: '私信',
    source: 'report',
    order: 60,
  },
  {
    id: 'report:messageLead',
    key: 'messageLead',
    label: '私信留资',
    group: '私信',
    source: 'report',
    order: 70,
  },
  {
    id: 'report:messageLeadRate',
    key: 'messageLeadRate',
    label: '私信留资率',
    group: '私信',
    source: 'report',
    order: 80,
  },
  {
    id: 'report:messageLeadCost',
    key: 'messageLeadCost',
    label: '私信留资成本',
    group: '私信',
    source: 'report',
    order: 90,
  },
  {
    id: 'report:id',
    key: 'id',
    label: '记录标识（ID）',
    group: '其他',
    source: 'report',
    order: 10,
  },
  {
    id: 'report:level',
    key: 'level',
    label: '报表层级',
    group: '其他',
    source: 'report',
    order: 20,
  },
  {
    id: 'report:dataCaliber',
    key: 'dataCaliber',
    label: '数据口径',
    group: '其他',
    source: 'report',
    order: 30,
  },
  {
    id: 'report:createdAt',
    key: 'createdAt',
    label: '创建时间',
    group: '其他',
    source: 'report',
    order: 40,
  },
  {
    id: 'report:updatedAt',
    key: 'updatedAt',
    label: '更新时间',
    group: '其他',
    source: 'report',
    order: 50,
  },
];

const RAW_FIELD_DEFINITIONS: Readonly<Record<string, RawFieldDefinition>> = {
  content_type: { label: '内容类型', group: '内容', order: 10 },
  note_type: { label: '笔记类型', group: '内容', order: 20 },
  author_id: { label: '作者标识（ID）', group: '内容', order: 30 },
  author_name: { label: '作者名称', group: '内容', order: 40 },
  fee: { label: '消费', group: '投放', order: 100 },
  impression: { label: '曝光', group: '投放', order: 110 },
  click: { label: '点击', group: '投放', order: 120 },
  ctr: { label: '点击率', group: '投放', order: 130 },
  acp: { label: '平均点击成本', group: '投放', order: 140 },
  cpc: { label: '平均点击成本', group: '投放', order: 140 },
  cpm: { label: '千次曝光成本', group: '投放', order: 150 },
  interaction: { label: '互动', group: '互动', order: 10 },
  like: { label: '点赞', group: '互动', order: 20 },
  comment: { label: '评论', group: '互动', order: 30 },
  collect: { label: '收藏', group: '互动', order: 40 },
  follow: { label: '关注', group: '互动', order: 50 },
  share: { label: '分享', group: '互动', order: 60 },
  cpi: { label: '单次互动成本', group: '互动', order: 70 },
  interaction_rate: { label: '互动率', group: '互动', order: 80 },
  like_rate: { label: '点赞率', group: '互动', order: 90 },
  collect_rate: { label: '收藏率', group: '互动', order: 100 },
  comment_rate: { label: '评论率', group: '互动', order: 110 },
  follow_rate: { label: '关注率', group: '互动', order: 120 },
  share_rate: { label: '分享率', group: '互动', order: 130 },
  video_play: { label: '视频播放', group: '视频', order: 10 },
  video_play_3s: { label: '3秒播放', group: '视频', order: 20 },
  video_play_5s: { label: '5秒播放', group: '视频', order: 30 },
  video_play_10s: { label: '10秒播放', group: '视频', order: 40 },
  video_complete_play: { label: '完整播放', group: '视频', order: 50 },
  video_play_rate: { label: '视频播放率', group: '视频', order: 60 },
  video_complete_play_rate: { label: '完整播放率', group: '视频', order: 70 },
  landing_page_visit: { label: '落地页访问', group: '线索', order: 10 },
  landing_page_pv: { label: '落地页访问', group: '线索', order: 10 },
  landing_page_visit_rate: { label: '落地页访问率', group: '线索', order: 15 },
  leads_button_impression: { label: '表单曝光', group: '线索', order: 20 },
  landing_form_imp_num: { label: '表单曝光', group: '线索', order: 20 },
  form_impression_rate: { label: '表单曝光率', group: '线索', order: 25 },
  leads: { label: '表单提交', group: '线索', order: 30 },
  form_submit_rate: { label: '表单提交率', group: '线索', order: 35 },
  form_submit_cost: { label: '表单提交成本', group: '线索', order: 36 },
  valid_leads: { label: '有效表单', group: '线索', order: 40 },
  valid_form_submit_rate: { label: '有效表单率', group: '线索', order: 45 },
  valid_form_submit_cost: { label: '有效表单成本', group: '线索', order: 46 },
  msg_leads_form_submit_num: { label: '合并线索', group: '线索', order: 50 },
  message_user: { label: '私信用户', group: '私信', order: 10 },
  message_consult: { label: '私信咨询', group: '私信', order: 20 },
  message_consult_rate: { label: '私信咨询率', group: '私信', order: 21 },
  message_consult_cost: { label: '私信咨询成本', group: '私信', order: 22 },
  initiative_message: { label: '私信开口', group: '私信', order: 30 },
  message_open_rate: { label: '私信开口率', group: '私信', order: 31 },
  msg_leads_num: { label: '私信留资', group: '私信', order: 40 },
  message_lead_rate: { label: '私信留资率', group: '私信', order: 41 },
  message_lead_cost: { label: '私信留资成本', group: '私信', order: 42 },
  product_click: { label: '商品点击', group: '电商', order: 10 },
  add_cart: { label: '加购', group: '电商', order: 20 },
  order_num: { label: '订单量', group: '电商', order: 30 },
  order_amount: { label: '成交金额', group: '电商', order: 40 },
  gmv: { label: '成交金额', group: '电商', order: 40 },
};

const NOTE_METADATA_PREFIX = 'note_meta__';

const NOTE_METADATA_FIELD_DEFINITIONS: Readonly<Record<string, RawFieldDefinition>> = {
  note_id: { label: '笔记标识（ID）', group: '内容', order: 1 },
  title: { label: '标题', group: '内容', order: 2 },
  desc: { label: '正文', group: '内容', order: 3 },
  image: { label: '封面', group: '内容', order: 4 },
  image_list: { label: '封面图片列表', group: '内容', order: 5 },
  note_url: { label: '笔记链接', group: '内容', order: 6 },
  author: { label: '作者', group: '内容', order: 10 },
  author_image: { label: '作者头像', group: '内容', order: 11 },
  create_time: { label: '发布时间', group: '内容', order: 20 },
  note_type: { label: '笔记来源类型', group: '内容', order: 30 },
  note_content_type: { label: '内容类型', group: '内容', order: 31 },
  note_source_type: { label: '笔记来源', group: '内容', order: 32 },
  taxonomy3: { label: '三级类目', group: '内容', order: 33 },
  status: { label: '笔记状态', group: '内容', order: 40 },
  report_status: { label: '报备状态', group: '内容', order: 41 },
  read_count: { label: '阅读数', group: '互动', order: 1 },
  read_rate: { label: '阅读率', group: '互动', order: 2 },
  interact_count: { label: '自然互动数', group: '互动', order: 3 },
  interact_rate: { label: '自然互动率', group: '互动', order: 4 },
  high_quality: { label: '优质笔记', group: '内容', order: 50 },
  high_potential: { label: '高潜笔记', group: '内容', order: 51 },
  win_horse_note: { label: '优胜笔记', group: '内容', order: 52 },
  is_hit_strategy: { label: '命中策略', group: '内容', order: 53 },
  hit_strategy_content: { label: '命中策略内容', group: '内容', order: 54 },
  cooperate_state: { label: '合作笔记', group: '内容', order: 60 },
  cooperate_state_authorization: { label: '智能标题授权', group: '内容', order: 61 },
  intelligent_creative_link: { label: '智能创意授权链路', group: '内容', order: 62 },
  cooperate_component_type: { label: '合作组件类型', group: '内容', order: 63 },
  cooperate_hot_note: { label: '合作热门笔记', group: '内容', order: 64 },
  crowd_creation_note: { label: '共创笔记', group: '内容', order: 65 },
  special_note: { label: '特殊笔记类型', group: '内容', order: 66 },
  staff_tag: { label: '员工标签', group: '内容', order: 70 },
  staff_area: { label: '员工地域', group: '内容', order: 71 },
  reservations: { label: '预约数', group: '互动', order: 10 },
  has_live_trailer: { label: '包含直播预告', group: '内容', order: 80 },
  live_start_time: { label: '直播开始时间', group: '内容', order: 81 },
  live_trailer_enable: { label: '直播预告启用', group: '内容', order: 82 },
  item_id: { label: '商品标识（ID）', group: '电商', order: 1 },
  item_ids: { label: '商品标识列表（ID）', group: '电商', order: 2 },
  note_spu_info: { label: '绑定标准化产品单元（SPU）', group: '电商', order: 3 },
  note_multi_spu_info: {
    label: '绑定标准化产品单元列表（SPU）',
    group: '电商',
    order: 4,
  },
  has_shop_card: { label: '商品笔记', group: '电商', order: 10 },
  has_shop: { label: '包含店铺', group: '电商', order: 11 },
  has_shop_goods: { label: '包含店铺商品', group: '电商', order: 12 },
  has_local_shop_goods: { label: '包含本地商品', group: '电商', order: 13 },
  has_bridge: { label: '包含跳转组件', group: '内容', order: 90 },
};

const RAW_KEYS_SHOWN_BY_FIXED_COLUMNS = new Set([
  'time',
  'note_id',
  'note_title',
  'note_image',
  'note_jump_url',
  'advertiser_id',
  'advertiser_name',
  'campaign_id',
  'campaign_name',
  'unit_id',
  'unit_name',
  'creativity_id',
  'creativity_name',
  'creative_id',
  'creative_name',
  'note_meta__note_id',
  'note_meta__title',
  'note_meta__image',
  'note_meta__note_url',
]);

const GROUP_ORDER = new Map(
  XIAOHONGSHU_REPORT_GROUPS.map((group, index) => [group, index] as const)
);

function compareStableKeys(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

export function getXiaohongshuReportDataColumns(
  reports: readonly IXiaohongshuDailyReport[],
  allRawFieldKeys: readonly string[] = []
): XiaohongshuReportDataColumn[] {
  const rawKeys = new Set<string>(allRawFieldKeys);
  for (const report of reports) {
    for (const key of Object.keys(report.rawPayload ?? {})) rawKeys.add(key);
  }
  for (const key of RAW_KEYS_SHOWN_BY_FIXED_COLUMNS) rawKeys.delete(key);

  const rawColumns = [...rawKeys].map<XiaohongshuReportDataColumn>((key) => {
    const metadataKey = key.startsWith(NOTE_METADATA_PREFIX)
      ? key.slice(NOTE_METADATA_PREFIX.length)
      : null;
    const definition = metadataKey
      ? NOTE_METADATA_FIELD_DEFINITIONS[metadataKey]
      : RAW_FIELD_DEFINITIONS[key];
    return {
      id: `raw:${key}`,
      key,
      label:
        definition?.label ??
        (metadataKey
          ? `笔记元数据·${getXiaohongshuFieldLabel(metadataKey)}`
          : getXiaohongshuFieldLabel(key)),
      group: definition?.group ?? (metadataKey ? '内容' : '其他'),
      source: 'raw',
      order: definition?.order ?? 10_000,
    };
  });

  return [...REPORT_FIXED_COLUMNS, ...rawColumns].sort((left, right) => {
    const groupDelta = (GROUP_ORDER.get(left.group) ?? 0) - (GROUP_ORDER.get(right.group) ?? 0);
    if (groupDelta !== 0) return groupDelta;
    const orderDelta = left.order - right.order;
    return orderDelta !== 0 ? orderDelta : compareStableKeys(left.key, right.key);
  });
}

export function getXiaohongshuReportColumnValue(
  report: IXiaohongshuDailyReport,
  column: XiaohongshuReportDataColumn
): unknown {
  if (column.source === 'raw') return report.rawPayload?.[column.key];
  if (column.key === 'level') {
    return {
      account: '账户',
      campaign: '计划',
      unit: '单元',
      creative: '创意',
      note: '笔记',
    }[report.level];
  }
  if (column.key === 'dataCaliber') return report.dataCaliber === 1 ? '转化时间' : '计费时间';
  return report[column.key as keyof IXiaohongshuDailyReport];
}

export function formatXiaohongshuReportValue(value: unknown, key?: string): string {
  return formatXiaohongshuDisplayValue(value, key);
}

export function getSafeXiaohongshuHttpUrl(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const candidate = value.trim();
  try {
    const url = new URL(candidate);
    if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.username || url.password) {
      return null;
    }
    return candidate;
  } catch {
    return null;
  }
}

export function getSafeXiaohongshuImageUrl(value: unknown): string | null {
  const safeUrl = getSafeXiaohongshuHttpUrl(value);
  if (!safeUrl) return null;

  const url = new URL(safeUrl);
  if (url.protocol === 'http:') url.protocol = 'https:';
  return url.toString();
}
