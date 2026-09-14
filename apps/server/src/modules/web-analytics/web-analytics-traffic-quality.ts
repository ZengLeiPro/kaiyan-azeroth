import { Prisma } from '@prisma/client';

/**
 * 默认看板排除两类高置信自动化会话，同时保留原始事件供 includeBots=true 回看：
 * 1) 两分钟内出现三个及以上国家；
 * 2) 同一会话至少三篇文章在 pageview 后十秒内读到 100%。
 */
export function buildKnownAutomationExclusion(startDate: Date, endDate: Date): Prisma.Sql {
  return Prisma.sql`
    NOT EXISTS (
      SELECT 1
      FROM web_analytics.events travel
      WHERE e.sid IS NOT NULL
        AND travel.sid = e.sid
        AND travel.site = e.site
        AND travel.received_at >= ${startDate}
        AND travel.received_at < ${endDate}
        AND NULLIF(travel.country, '') IS NOT NULL
        AND travel.country <> '0'
      GROUP BY travel.sid
      HAVING COUNT(DISTINCT travel.country) >= 3
        AND MAX(travel.received_at) - MIN(travel.received_at) <= INTERVAL '2 minutes'
    )
    AND NOT EXISTS (
      SELECT 1
      FROM web_analytics.events read100
      WHERE e.sid IS NOT NULL
        AND read100.sid = e.sid
        AND read100.site = e.site
        AND read100.received_at >= ${startDate}
        AND read100.received_at < ${endDate}
        AND read100.event = 'article_read_100'
        AND read100.path IS NOT NULL
        AND EXISTS (
          SELECT 1
          FROM web_analytics.events pageview
          WHERE pageview.sid = read100.sid
            AND pageview.site = read100.site
            AND pageview.path = read100.path
            AND pageview.event = 'pageview'
            AND pageview.received_at <= read100.received_at
            AND read100.received_at <= pageview.received_at + INTERVAL '10 seconds'
        )
      GROUP BY read100.sid
      HAVING COUNT(DISTINCT read100.path) >= 3
    )
  `;
}
