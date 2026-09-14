import type { IDingtalkCalendarEventResponse } from '@ky-azeroth/shared/types/calendar-event';

// @no-payload: 只读页面，数据来自钉钉同步
// @no-formdata-needed: 只读展示页面

/**
 * 日程事件前端展示类型（强绑定 IDingtalkCalendarEventResponse）
 */
export interface CalendarEventProfile extends IDingtalkCalendarEventResponse {
  /** 用于 useCrud 兼容的 id 字段，映射自 eventId */
  id: string;
}

/**
 * 日程事件表单数据（只读页面，无表单）
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface CalendarEventFormData {}

/**
 * API 响应 -> 前端展示
 */
export function toCalendarEventProfile(data: IDingtalkCalendarEventResponse): CalendarEventProfile {
  return {
    ...data,
    id: data.eventId,
  };
}

/**
 * 展示/响应 -> 表单数据（只读页面）
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function toCalendarEventFormData(_profile: CalendarEventProfile): CalendarEventFormData {
  return {};
}
