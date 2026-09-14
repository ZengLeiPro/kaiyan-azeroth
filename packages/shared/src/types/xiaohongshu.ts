import type {
  XIAOHONGSHU_CONNECTION_STATUSES,
  XIAOHONGSHU_DATA_CALIBERS,
  XIAOHONGSHU_RANKING_METRICS,
  XIAOHONGSHU_REPORT_LEVELS,
  XIAOHONGSHU_SCOPES,
  XIAOHONGSHU_SYNC_STATUSES,
} from '../constants/xiaohongshu';
import type { DateString, DecimalNumber, ISODateTime, PaginatedResponse } from './common';

export type XiaohongshuReportLevel = (typeof XIAOHONGSHU_REPORT_LEVELS)[number];
export type XiaohongshuSyncStatus = (typeof XIAOHONGSHU_SYNC_STATUSES)[number];
export type XiaohongshuConnectionStatus = (typeof XIAOHONGSHU_CONNECTION_STATUSES)[number];
export type XiaohongshuScope = (typeof XIAOHONGSHU_SCOPES)[number];
export type XiaohongshuDataCaliber = (typeof XIAOHONGSHU_DATA_CALIBERS)[number];
export type XiaohongshuRankingMetric = (typeof XIAOHONGSHU_RANKING_METRICS)[number];
export type XiaohongshuMetricCoverageStatus = 'full' | 'partial' | 'unavailable';

/** 小红书官方报表原始行支持的 JSON 值。 */
export type XiaohongshuJsonValue =
  | string
  | number
  | boolean
  | null
  | XiaohongshuJsonValue[]
  | { [key: string]: XiaohongshuJsonValue };
export type XiaohongshuReportRawPayload = { [key: string]: XiaohongshuJsonValue };

/** OAuth state 持久化模型；仅供后端类型覆盖，不作为 API 响应。 */
export interface IXiaohongshuOauthState {
  id: string;
  stateHash: string;
  expiresAt: ISODateTime;
  consumedAt?: ISODateTime | null;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
  deletedAt?: ISODateTime | null;
  createdBy?: string | null;
  updatedBy?: string | null;
  version: number;
}

/**
 * 小红书聚光 OAuth 连接的对外状态。
 * 安全约束：响应类型绝不包含 access token、refresh token 或其他凭据。
 */
export interface IXiaohongshuConnection {
  id: string;
  status: XiaohongshuConnectionStatus;
  scopes: XiaohongshuScope[];
  expiresAt?: ISODateTime | null;
  lastSyncedAt?: ISODateTime | null;
  errorMessage?: string | null;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

export interface IXiaohongshuConnectionResponse extends IXiaohongshuConnection {}

/** 已授权连接下可同步的聚光广告主。 */
export interface IXiaohongshuAdvertiser {
  advertiserId: string;
  advertiserName: string;
  connectionId: string;
  status?: string | null;
  createdAt?: ISODateTime;
  updatedAt?: ISODateTime;
}

export interface IXiaohongshuAdvertiserResponse extends IXiaohongshuAdvertiser {}

/** 小红书聚光获客转化原子指标；成本与转化率由消费、点击和这些计数派生。 */
export interface IXiaohongshuConversionMetrics {
  landingPageVisit?: number | null;
  formImpression?: number | null;
  formSubmit?: number | null;
  validFormSubmit?: number | null;
  /** 表单或私信合并线索量；账户层官方报表不提供。 */
  combinedLead?: number | null;
  messageUser?: number | null;
  messageConsult?: number | null;
  messageOpen?: number | null;
  messageLead?: number | null;
}

export interface IXiaohongshuMetricCoverage {
  landingPageVisit: XiaohongshuMetricCoverageStatus;
  formImpression: XiaohongshuMetricCoverageStatus;
  formSubmit: XiaohongshuMetricCoverageStatus;
  validFormSubmit: XiaohongshuMetricCoverageStatus;
  combinedLead: XiaohongshuMetricCoverageStatus;
  messageUser: XiaohongshuMetricCoverageStatus;
  messageConsult: XiaohongshuMetricCoverageStatus;
  messageOpen: XiaohongshuMetricCoverageStatus;
  messageLead: XiaohongshuMetricCoverageStatus;
}

/** 小红书聚光获客漏斗派生指标。 */
export interface IXiaohongshuFunnelDerivedMetrics {
  /** @precision Decimal */
  messageConsultRate?: DecimalNumber | null;
  /** @precision Decimal */
  messageOpenRate?: DecimalNumber | null;
  /** @precision Decimal */
  messageLeadRate?: DecimalNumber | null;
  /** @precision Decimal */
  messageConsultCost?: DecimalNumber | null;
  /** @precision Decimal */
  messageLeadCost?: DecimalNumber | null;
  /** @precision Decimal */
  landingPageVisitRate?: DecimalNumber | null;
  /** @precision Decimal */
  formImpressionRate?: DecimalNumber | null;
  /** @precision Decimal */
  formSubmitRate?: DecimalNumber | null;
  /** @precision Decimal */
  validFormSubmitRate?: DecimalNumber | null;
  /** @precision Decimal */
  formSubmitCost?: DecimalNumber | null;
  /** @precision Decimal */
  validFormSubmitCost?: DecimalNumber | null;
}

/** 小红书聚光日报核心指标与维度。 */
export interface IXiaohongshuDailyReport
  extends IXiaohongshuConversionMetrics, IXiaohongshuFunnelDerivedMetrics {
  id: string;
  statDate: DateString;
  advertiserId: string;
  advertiserName?: string | null;
  level: XiaohongshuReportLevel;
  dataCaliber: XiaohongshuDataCaliber;
  campaignId?: string | null;
  campaignName?: string | null;
  unitId?: string | null;
  unitName?: string | null;
  creativeId?: string | null;
  creativeName?: string | null;
  noteId?: string | null;
  noteTitle?: string | null;
  noteImage?: string | null;
  noteJumpUrl?: string | null;
  /** 官方离线报表的完整原始行，字段不做裁剪。 */
  rawPayload: XiaohongshuReportRawPayload;
  /** 消耗金额。 @precision Decimal */
  fee: DecimalNumber;
  impression: number;
  click: number;
  interaction: number;
  like: number;
  comment: number;
  collect: number;
  follow: number;
  share: number;
  /** 点击率。 @precision Decimal */
  ctr?: DecimalNumber | null;
  /** 平均点击成本。 @precision Decimal */
  cpc?: DecimalNumber | null;
  /** 千次曝光成本。 @precision Decimal */
  cpm?: DecimalNumber | null;
  /** 单次互动成本。 @precision Decimal */
  cpi?: DecimalNumber | null;
  /** 互动率。 @precision Decimal */
  interactionRate?: DecimalNumber | null;
  /** @precision Decimal */
  likeRate?: DecimalNumber | null;
  /** @precision Decimal */
  collectRate?: DecimalNumber | null;
  /** @precision Decimal */
  commentRate?: DecimalNumber | null;
  /** @precision Decimal */
  followRate?: DecimalNumber | null;
  /** @precision Decimal */
  shareRate?: DecimalNumber | null;
  createdAt?: ISODateTime;
  updatedAt?: ISODateTime;
}

export interface IXiaohongshuDailyReportResponse extends PaginatedResponse<IXiaohongshuDailyReport> {
  dataCaliber: XiaohongshuDataCaliber;
  /** 当前完整查询结果内所有官方原始字段，供分页表格保持稳定列结构。 */
  rawFieldKeys: string[];
}

export interface IXiaohongshuSyncRunError {
  advertiserId?: string;
  level?: XiaohongshuReportLevel;
  dataCaliber?: XiaohongshuDataCaliber;
  message: string;
}

/** 一次手动或定时聚光日报同步任务。 */
export interface IXiaohongshuSyncRun {
  id: string;
  status: XiaohongshuSyncStatus;
  startDate?: DateString | null;
  endDate?: DateString | null;
  levels: XiaohongshuReportLevel[];
  advertiserIds: string[];
  syncedRows: number;
  errors: IXiaohongshuSyncRunError[];
  startedAt: ISODateTime;
  finishedAt?: ISODateTime | null;
  createdAt?: ISODateTime;
  updatedAt?: ISODateTime;
}

export interface IXiaohongshuSyncRunResponse extends IXiaohongshuSyncRun {}

export interface IXiaohongshuSyncRunReport {
  shardCount: number;
  succeeded: number;
  failed: number;
}

export interface IXiaohongshuSyncRunDetail extends IXiaohongshuSyncRun {
  counts: Record<string, number>;
  report: IXiaohongshuSyncRunReport | null;
}

export interface IXiaohongshuMetrics
  extends IXiaohongshuConversionMetrics, IXiaohongshuFunnelDerivedMetrics {
  /** 消耗金额。 @precision Decimal */
  fee: DecimalNumber;
  impression: number;
  click: number;
  interaction: number;
  like: number;
  comment: number;
  collect: number;
  follow: number;
  share: number;
  metricCoverage: IXiaohongshuMetricCoverage;
  /** 点击率。 @precision Decimal */
  ctr?: DecimalNumber | null;
  /** 平均点击成本。 @precision Decimal */
  cpc?: DecimalNumber | null;
  /** 千次曝光成本。 @precision Decimal */
  cpm?: DecimalNumber | null;
  /** 单次互动成本。 @precision Decimal */
  cpi?: DecimalNumber | null;
  /** 互动率。 @precision Decimal */
  interactionRate?: DecimalNumber | null;
  /** @precision Decimal */
  likeRate?: DecimalNumber | null;
  /** @precision Decimal */
  collectRate?: DecimalNumber | null;
  /** @precision Decimal */
  commentRate?: DecimalNumber | null;
  /** @precision Decimal */
  followRate?: DecimalNumber | null;
  /** @precision Decimal */
  shareRate?: DecimalNumber | null;
}

export interface IXiaohongshuAnalyticsRange {
  startDate: DateString;
  endDate: DateString;
  dataCaliber: XiaohongshuDataCaliber;
}

export interface IXiaohongshuMetricDelta {
  /** @precision Decimal */
  current: DecimalNumber;
  /** @precision Decimal */
  previous: DecimalNumber;
  /** previous 为 0 时为 null。 @precision Decimal */
  changeRate: DecimalNumber | null;
}

export interface IXiaohongshuSummaryComparison {
  range: IXiaohongshuAnalyticsRange;
  totals: IXiaohongshuMetrics;
}

export interface IXiaohongshuSummaryResponse {
  range: IXiaohongshuAnalyticsRange;
  level: XiaohongshuReportLevel;
  totals: IXiaohongshuMetrics;
  comparison?: IXiaohongshuSummaryComparison;
  deltas?: Record<
    | 'fee'
    | 'impression'
    | 'click'
    | 'interaction'
    | 'messageConsult'
    | 'messageLead'
    | 'formSubmit'
    | 'validFormSubmit',
    IXiaohongshuMetricDelta
  >;
}

export interface IXiaohongshuTrendPoint extends IXiaohongshuMetrics {
  date: DateString;
}

export interface IXiaohongshuTrendResponse {
  range: IXiaohongshuAnalyticsRange;
  level: XiaohongshuReportLevel;
  points: IXiaohongshuTrendPoint[];
}

export interface IXiaohongshuRankingItem extends IXiaohongshuMetrics {
  id: string;
  name: string;
  level: XiaohongshuReportLevel;
  /** 笔记排行的封面与跳转地址；其他层级不返回。 */
  noteImage?: string | null;
  noteJumpUrl?: string | null;
  /** 当前排序指标的值；fee 时遵循 DecimalNumber 规范。 @precision Decimal */
  value: DecimalNumber;
  /** 当前排序指标为可空指标时返回其覆盖率。 */
  valueCoverage?: XiaohongshuMetricCoverageStatus;
}

export interface IXiaohongshuRankingResponse {
  range: IXiaohongshuAnalyticsRange;
  level: XiaohongshuReportLevel;
  metric: XiaohongshuRankingMetric;
  items: IXiaohongshuRankingItem[];
}

/** 手动同步接口返回的已创建任务摘要。 */
export interface IXiaohongshuManualSyncResult {
  runId: string;
  status: XiaohongshuSyncStatus;
  startDate?: DateString;
  endDate?: DateString;
  levels: XiaohongshuReportLevel[];
  advertiserIds: string[];
}

export type XiaohongshuDatasetGroup =
  | 'report'
  | 'delivery'
  | 'content'
  | 'search'
  | 'audience'
  | 'conversion'
  | 'account'
  | 'asset'
  | 'audit';

export type XiaohongshuDatasetAvailability =
  | 'available'
  | 'connection_missing'
  | 'scope_missing'
  | 'requires_context'
  | 'requires_whitelist'
  | 'requires_extra_scope'
  | 'role_unsupported'
  | 'contract_probe';

export type XiaohongshuDatasetParameterValueType =
  | 'string'
  | 'number'
  | 'boolean'
  | 'string[]'
  | 'number[]'
  | 'object'
  | 'json';

/** Agent 构造数据集查询请求所需的参数提示。 */
export interface IXiaohongshuDatasetParameter {
  name: string;
  label: string;
  description: string;
  source: 'request' | 'params';
  required: boolean;
  valueType: XiaohongshuDatasetParameterValueType;
  enumValues?: XiaohongshuJsonValue[];
}

/** 数据目录中的一项只读能力；可用性按目标广告主所属的有效连接实时计算。 */
export interface IXiaohongshuDatasetDefinition {
  id: string;
  label: string;
  group: XiaohongshuDatasetGroup;
  description: string;
  requiredScope?: string | null;
  availability: XiaohongshuDatasetAvailability;
  availabilityReason?: string | null;
  queryable: boolean;
  source: 'official_api' | 'local_report';
  endpoint?: string | null;
  method: 'GET' | 'POST' | null;
  requiredParams: string[];
  parameters: IXiaohongshuDatasetParameter[];
  allowsAdditionalParams: boolean;
  pagination: 'none' | 'page' | 'page_object' | 'page_num' | 'page_index' | 'page_camel';
  supportsDateRange: boolean;
  supportsDataCaliber: boolean;
  defaults: XiaohongshuReportRawPayload;
  coreFields: string[];
}

export interface IXiaohongshuDatasetCatalogResponse {
  datasets: IXiaohongshuDatasetDefinition[];
  scopes: string[];
  connected: boolean;
  updatedAt: ISODateTime;
}

export interface IXiaohongshuDatasetField {
  key: string;
  label: string;
  group: string;
  valueType: 'string' | 'number' | 'boolean' | 'object' | 'array' | 'null' | 'mixed';
  isCore: boolean;
}

export interface IXiaohongshuDatasetQueryResponse {
  dataset: IXiaohongshuDatasetDefinition;
  items: XiaohongshuReportRawPayload[];
  fields: IXiaohongshuDatasetField[];
  total: number;
  /** 官方明确返回总数时为 exact；否则仅用于驱动翻页，不能作为精确记录总量。 */
  totalMode: 'exact' | 'estimated';
  hasMore: boolean;
  page: number;
  pageSize: number;
  totalPages: number;
  aggregation?: XiaohongshuReportRawPayload | null;
  metadata?: XiaohongshuReportRawPayload | null;
  requestId?: string | null;
  fetchedAt: ISODateTime;
}
