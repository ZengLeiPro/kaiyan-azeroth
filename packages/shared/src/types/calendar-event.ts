/**
 * 钉钉日程事件实体（只读，来自钉钉同步）
 *
 * 该类型对应 DingtalkCalendarEvent 模型，数据由钉钉同步写入，业务层只读。
 * 不提供 ICreate/IUpdate 类型。
 */
export interface IDingtalkCalendarEvent {
  /** 钉钉日程事件 ID（主键，非 UUID） */
  eventId: string;
  title?: string | null;
  description?: string | null;
  startTime?: string | null;
  endTime?: string | null;
  location?: string | null;
  creator?: string | null;
  attendees?: string[] | null;
  syncedAt?: string | null;
}

/**
 * 钉钉日程事件 API 响应类型
 */

export interface IDingtalkCalendarEventResponse extends IDingtalkCalendarEvent {}
