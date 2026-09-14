import { PrismaClient } from '@prisma/client';

import { CalendarApi, DingtalkCalendarEvent } from '../dingtalk/calendar';
import { normalizeText, parseDateTimeLike } from '../utils';
import { getSyncState, setSyncState, type SyncResult } from './sync-state.helper';

export type CalendarSyncOptions = {
  /** 首次同步回溯天数（默认 30），增量同步走 syncToken，不依赖此参数 */
  lookbackDays: number;
};

/**
 * 同步钉钉日历事件
 *
 * 迁移自 apps/dingtalk-sync/src/sync/calendar-sync.ts，逻辑不变。
 *
 * 策略：每用户独立 syncToken（state_key = "union:${unionId}"）。
 * 遍历所有活跃员工的 unionId，用 syncToken 获取增量事件，按 eventId upsert。
 */
export async function syncCalendar(
  prisma: PrismaClient,
  calendarApi: CalendarApi,
  options: CalendarSyncOptions
): Promise<SyncResult> {
  const employees = await prisma.employee.findMany({
    where: {
      dingtalkActive: true,
      dingtalkUnionId: { not: null },
    },
    select: { dingtalkUnionId: true },
  });

  const unionIds = employees
    .map((e) => e.dingtalkUnionId)
    .filter((id): id is string => Boolean(id));

  console.log(`准备遍历 ${unionIds.length} 名活跃员工的日历`);

  const allEvents: Array<DingtalkCalendarEvent & { calendarUserId: string }> = [];
  const tokenUpdates: Array<{ key: string; token: string }> = [];

  for (let i = 0; i < unionIds.length; i++) {
    const unionId = unionIds[i];
    if (!unionId) continue;
    const stateKey = `union:${unionId}`;

    const state = await getSyncState(prisma, 'dingtalk', 'calendar_events', stateKey);
    const syncToken = normalizeText(state?.sync_token) || null;

    try {
      const result = await calendarApi.syncUserEventsIncremental(
        unionId,
        syncToken,
        options.lookbackDays
      );

      for (const event of result.events) {
        allEvents.push({
          ...event,
          // 加上用户前缀防止不同用户的相同 eventId 冲突
          eventId: `${unionId}__${event.eventId}`,
          calendarUserId: unionId,
        });
      }

      if (result.syncToken) {
        tokenUpdates.push({ key: stateKey, token: result.syncToken });
      }
    } catch (err) {
      const msg = (err as { message?: string })?.message ?? String(err);
      console.warn(`同步用户(${unionId})日程失败，跳过 [${i + 1}/${unionIds.length}]: ${msg}`);
    }
  }

  // 去重（相同 eventId 保留 updateTime 最新的）
  const deduped = new Map<string, DingtalkCalendarEvent & { calendarUserId: string }>();
  for (const event of allEvents) {
    if (!event.eventId) continue;
    const existing = deduped.get(event.eventId);
    if (!existing) {
      deduped.set(event.eventId, event);
      continue;
    }
    if ((event.updateTime || '') >= (existing.updateTime || '')) {
      deduped.set(event.eventId, event);
    }
  }

  console.log(`共获取到 ${deduped.size} 条去重后的日历事件`);

  let syncedCount = 0;
  for (const [, event] of deduped) {
    try {
      const startTime = parseDateTimeLike(event.startTime);
      const endTime = parseDateTimeLike(event.endTime);
      let attendeesJson: ReturnType<typeof JSON.parse> | null = null;
      try {
        attendeesJson = JSON.parse(event.attendees) as unknown;
      } catch {
        // attendees 解析失败，忽略
      }

      await prisma.dingtalkCalendarEvent.upsert({
        where: { eventId: event.eventId },
        create: {
          eventId: event.eventId,
          title: event.title || null,
          description: event.description || null,
          startTime,
          endTime,
          location: event.location || null,
          creator: event.creator || null,
          attendees: attendeesJson,
          syncedAt: new Date(),
        },
        update: {
          title: event.title || null,
          description: event.description || null,
          startTime,
          endTime,
          location: event.location || null,
          creator: event.creator || null,
          attendees: attendeesJson,
          syncedAt: new Date(),
        },
      });
      syncedCount++;
    } catch (err: unknown) {
      const msg = (err as { message?: string })?.message ?? String(err);
      console.error(`upsert 日历事件(${event.eventId})失败: ${msg}`);
    }
  }

  for (const tokenUpdate of tokenUpdates) {
    await setSyncState(
      prisma,
      'dingtalk',
      'calendar_events',
      { sync_token: tokenUpdate.token, updated_at: Date.now() },
      tokenUpdate.key
    );
  }

  return { entity: 'dingtalk_calendar_events', count: syncedCount };
}
