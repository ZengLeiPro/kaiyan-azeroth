import { DingtalkAuth } from '../../dingtalk-core/dingtalk-auth.service';
import { DingtalkHttp } from '../../dingtalk-core/dingtalk-http';
import { formatIsoWithOffset, normalizeText, safeJsonStringify } from '../utils';

export type DingtalkCalendarEvent = {
  eventId: string;
  title: string;
  description: string;
  startTime: string;
  endTime: string;
  location: string;
  creator: string;
  attendees: string; // JSON string
  status: string;
  updateTime: string;
};

export type CalendarDeltaResult = {
  events: DingtalkCalendarEvent[];
  syncToken: string;
};

/**
 * 把钉钉日程 raw 对象归一化为入库结构。
 *
 * SYS-CAL fix：location/creator 字段只取标量字段链
 * （displayName/title/address/name），缺失时回退 '' 而非把对象本身交给
 * String() —— 否则会落 '[object Object]'。
 *
 * 抽为顶层函数便于 spec 直接测，CalendarApi.normalizeEvent 是其薄包装。
 */
export function normalizeDingtalkCalendarEvent(e: Record<string, unknown>): DingtalkCalendarEvent {
  const attendees = Array.isArray(e?.attendees) ? e.attendees : [];
  const location = (e?.location ?? {}) as Record<string, unknown>;
  const creator = (e?.organizer ?? e?.creator ?? {}) as Record<string, unknown>;

  return {
    eventId: normalizeText(e?.id),
    title: normalizeText(e?.summary),
    description: normalizeText(e?.description),
    startTime: normalizeText(
      (e?.start as Record<string, unknown> | undefined)?.dateTime ??
        (e?.start as Record<string, unknown> | undefined)?.date
    ),
    endTime: normalizeText(
      (e?.end as Record<string, unknown> | undefined)?.dateTime ??
        (e?.end as Record<string, unknown> | undefined)?.date
    ),
    location: normalizeText(
      location?.displayName ?? location?.title ?? location?.address ?? location?.name ?? ''
    ),
    creator: normalizeText(creator?.displayName ?? creator?.id ?? creator?.name ?? ''),
    attendees: safeJsonStringify(attendees),
    status: normalizeText(e?.status),
    updateTime: normalizeText(e?.updateTime),
  };
}

/**
 * 钉钉日历 API
 *
 * 迁移自 apps/dingtalk-sync/src/dingtalk/calendar.ts，保持纯 class。
 */
export class CalendarApi {
  constructor(
    private readonly http: DingtalkHttp,
    private readonly auth: DingtalkAuth
  ) {}

  /** 增量同步用户日程事件 */
  async syncUserEventsIncremental(
    unionId: string,
    syncToken: string | null,
    daysBack: number = 30
  ): Promise<CalendarDeltaResult> {
    const all: DingtalkCalendarEvent[] = [];

    const isIncremental = Boolean(syncToken);
    const baseParams: Record<string, unknown> = {
      showDeleted: true,
      maxResults: 100,
      maxAttendees: 100,
    };

    if (isIncremental) {
      baseParams.syncToken = syncToken;
    } else {
      const timeMin = formatIsoWithOffset(new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000));
      baseParams.timeMin = timeMin;
    }

    let nextToken: string | undefined;
    let latestSyncToken = syncToken || '';

    for (let page = 0; page < 1000; page++) {
      const data = await this.getEvents(unionId, {
        ...baseParams,
        ...(nextToken ? { nextToken } : {}),
      });

      const dataObj = data as Record<string, unknown>;
      const events = Array.isArray(dataObj?.events)
        ? (dataObj.events as Array<Record<string, unknown>>)
        : [];

      for (const e of events) {
        const parsed = this.normalizeEvent(e);
        if (!parsed.eventId) continue;
        all.push(parsed);
      }

      const next = normalizeText(dataObj?.nextToken);
      const sync = normalizeText(dataObj?.syncToken);
      if (sync) latestSyncToken = sync;

      if (!next || next === nextToken) break;
      nextToken = next;
    }

    console.log(`用户(${unionId})日程同步完成，共 ${all.length} 条，增量=${isIncremental}`);
    return {
      events: all,
      syncToken: latestSyncToken,
    };
  }

  private normalizeEvent(e: Record<string, unknown>): DingtalkCalendarEvent {
    return normalizeDingtalkCalendarEvent(e);
  }

  private async getEvents(userId: string, params: Record<string, unknown>): Promise<unknown> {
    const token = await this.auth.getAccessToken();
    return this.http.get<unknown>(`/v1.0/calendar/users/${userId}/calendars/primary/events`, {
      params,
      headers: {
        'x-acs-dingtalk-access-token': token,
        'Content-Type': 'application/json',
      },
    });
  }
}
