/** 小红书聚光日报层级。 */
export const XIAOHONGSHU_REPORT_LEVELS = [
  'account',
  'campaign',
  'unit',
  'creative',
  'note',
] as const;

/** 小红书数据同步任务状态。 */
export const XIAOHONGSHU_SYNC_STATUSES = ['running', 'success', 'partial', 'failed'] as const;

/** 小红书聚光连接状态。 */
export const XIAOHONGSHU_CONNECTION_STATUSES = ['active', 'expired', 'error', 'disabled'] as const;

/** 小红书聚光 OAuth 固定授权范围。 */
export const XIAOHONGSHU_SCOPES = [
  'report_service',
  'ad_query',
  'ad_manage',
  'account_manage',
] as const;

/** 小红书聚光数据口径：0 按计费/点击时间，1 按转化时间。 */
export const XIAOHONGSHU_DATA_CALIBERS = [0, 1] as const;

/** 小红书聚光排行支持的指标。 */
export const XIAOHONGSHU_RANKING_METRICS = [
  'fee',
  'impression',
  'click',
  'interaction',
  'messageConsult',
  'messageLead',
  'formSubmit',
  'validFormSubmit',
] as const;
