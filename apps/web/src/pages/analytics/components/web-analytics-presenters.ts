import { WEB_ANALYTICS_EVENTS } from '@ky-azeroth/shared/constants';
import type { IWebAnalyticsBreakdownItem } from '@ky-azeroth/shared/types';

import { formatDateTimeDisplay } from '@/lib/date-utils';

export const EVENT_LABELS: Record<string, string> = {
  pageview: '页面访问',
  consult_cta_click: '点击咨询',
  consult_modal_open: '打开咨询弹窗',
  consult_modal_close: '关闭咨询弹窗',
  consult_channel_phone_click: '电话咨询',
  consult_channel_mail_click: '邮件咨询',
  consult_channel_wechat_customer_service_click: '微信客服',
  consult_channel_wechat_mp_click: '公众号',
  consult_channel_dingtalk_click: '钉钉咨询',
  consult_form_submit: '咨询留言',
  lead_submit: '线索提交',
  lead_signup_click: '注册意向',
  quote_request_submit: '报价申请',
  resource_download: '资料下载',
  ui_case_filter_click: '案例筛选',
};

export const TREND_METRICS = [
  { key: 'pv', label: 'PV', color: '#2563eb' },
  { key: 'uv', label: 'UV', color: '#16a34a' },
  { key: 'sessions', label: '会话', color: '#f59e0b' },
  { key: 'leads', label: '最终留资', color: '#dc2626' },
] as const;

export const SOURCE_DIMS = [
  { key: 'search_engine', label: '搜索引擎' },
  { key: 'utm_source', label: 'UTM 来源' },
  { key: 'ref_host', label: '来源域名' },
  { key: 'utm_medium', label: 'UTM 媒介' },
  { key: 'utm_campaign', label: 'UTM 活动' },
  { key: 'utm_term', label: 'UTM 关键词' },
  { key: 'utm_content', label: 'UTM 内容' },
  { key: 'device', label: '设备类型' },
  { key: 'browser', label: '浏览器' },
  { key: 'os', label: '操作系统' },
  { key: 'country', label: '国家/地区' },
  { key: 'region', label: '省份' },
  { key: 'city', label: '城市' },
  { key: 'isp', label: '运营商' },
  { key: 'lang', label: '浏览器语言' },
] as const;

export type WebAnalyticsOption = { value: string; label: string };
export type WebAnalyticsSiteOption = { value: string | null; label: string };

export const fmtNumber = (value: number | null | undefined): string =>
  value == null || Number.isNaN(value) ? '-' : value.toLocaleString('zh-CN');

export const fmtPercent = (value: number | null | undefined): string =>
  value == null || Number.isNaN(value) ? '-' : `${value.toFixed(2)}%`;

export const fmtChange = (value: number | null | undefined): string => {
  if (value == null || Number.isNaN(value)) return '较上期：无可比基数';
  return `较上期 ${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;
};

export function fmtDuration(seconds: number | null | undefined): string {
  if (seconds == null || Number.isNaN(seconds) || seconds <= 0) return '0s';
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.round(seconds % 60);
  return minutes > 0
    ? `${minutes}m${remainingSeconds.toString().padStart(2, '0')}s`
    : `${remainingSeconds}s`;
}

export function fmtTime(value: string | null | undefined): string {
  return formatDateTimeDisplay(value) || (value ? value : '-');
}

export function optionLabel(value: string, count?: number): string {
  return count == null ? value : `${value}（${count}）`;
}

function mergeSelectedOptions(
  options: WebAnalyticsOption[],
  selected: string[] | undefined
): WebAnalyticsOption[] {
  const seen = new Set(options.map((item) => item.value));
  const missing = (selected ?? [])
    .filter((value) => !seen.has(value))
    .map((value) => ({ value, label: value }));
  return [...missing, ...options];
}

export function toOptions(
  items: Array<{ value: string; label: string; count: number }> | undefined,
  selected: string[] | undefined
): WebAnalyticsOption[] {
  const options = (items ?? []).map((item) => ({
    value: item.value,
    label: optionLabel(item.label, item.count),
  }));
  return mergeSelectedOptions(options, selected);
}

export function toEventOptions(
  items: Array<{ value: string; count: number }> | undefined,
  selected: string[] | undefined
): WebAnalyticsOption[] {
  const countMap = new Map((items ?? []).map((item) => [item.value, item.count]));
  const values = Array.from(
    new Set([...WEB_ANALYTICS_EVENTS, ...(items ?? []).map((item) => item.value)])
  );
  const options = values.map((value) => ({
    value,
    label: optionLabel(EVENT_LABELS[value] ?? value, countMap.get(value)),
  }));
  return mergeSelectedOptions(options, selected);
}

export function toRankingItems(items: IWebAnalyticsBreakdownItem[]) {
  return items.map((item) => ({
    id: item.key,
    name: item.label,
    value: item.count,
    hint: `${item.percentage}%`,
  }));
}
