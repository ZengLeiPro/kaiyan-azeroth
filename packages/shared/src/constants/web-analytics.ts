/**
 * 官网第一方埋点常量。
 *
 * 事件名必须与 example.com 的 ConsultSystem / beacon 采集器保持一致。
 */

export const WEB_ANALYTICS_PAGEVIEW_EVENT = 'pageview';

export const WEB_ANALYTICS_CONSULT_EVENTS = [
  'consult_cta_click',
  'consult_modal_open',
  'consult_modal_close',
  'consult_channel_phone_click',
  'consult_channel_mail_click',
  'consult_channel_wechat_customer_service_click',
  'consult_channel_wechat_mp_click',
  'consult_channel_dingtalk_click',
] as const;

export const WEB_ANALYTICS_CONSULT_CHANNEL_CLICK_EVENTS = [
  'consult_channel_phone_click',
  'consult_channel_mail_click',
  'consult_channel_wechat_customer_service_click',
  'consult_channel_wechat_mp_click',
  'consult_channel_dingtalk_click',
] as const;

/** 真正形成销售线索的最终留资事件。咨询入口点击不属于最终转化。 */
export const WEB_ANALYTICS_LEAD_SUBMIT_EVENTS = [
  'lead_submit',
  'quote_request_submit',
  'consult_form_submit',
] as const;

export const WEB_ANALYTICS_EVENTS = [
  WEB_ANALYTICS_PAGEVIEW_EVENT,
  ...WEB_ANALYTICS_CONSULT_EVENTS,
  ...WEB_ANALYTICS_LEAD_SUBMIT_EVENTS,
  'lead_signup_click',
  'resource_download',
  'ui_case_filter_click',
] as const;

export type WebAnalyticsEventName = (typeof WEB_ANALYTICS_EVENTS)[number];

export const WEB_ANALYTICS_BREAKDOWN_DIMENSIONS = [
  'search_engine',
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
  'ref_host',
  'path',
  'page_type',
  'placement',
  'channel',
  'device',
  'browser',
  'os',
  'country',
  'region',
  'city',
  'isp',
  'lang',
] as const;

export type WebAnalyticsBreakdownDimension = (typeof WEB_ANALYTICS_BREAKDOWN_DIMENSIONS)[number];

export const WEB_ANALYTICS_BREAKDOWN_DIMENSION_LABELS: Record<
  WebAnalyticsBreakdownDimension,
  string
> = {
  search_engine: '搜索引擎',
  utm_source: 'UTM 来源',
  utm_medium: 'UTM 媒介',
  utm_campaign: 'UTM 活动',
  utm_term: 'UTM 关键词',
  utm_content: 'UTM 内容',
  ref_host: '来源域名',
  path: '页面路径',
  page_type: '页面类型',
  placement: '咨询位置',
  channel: '咨询渠道',
  device: '设备类型',
  browser: '浏览器',
  os: '操作系统',
  country: '国家/地区',
  region: '省份',
  city: '城市',
  isp: '运营商',
  lang: '浏览器语言',
};

export const WEB_ANALYTICS_FUNNEL_STAGES = [
  { key: 'sessions', label: '访问会话' },
  { key: 'consult_cta_click', label: '点击咨询' },
  { key: 'consult_modal_open', label: '打开弹窗' },
  { key: 'consult_channel_click', label: '选择渠道' },
  { key: 'lead_submit', label: '最终留资' },
] as const;
