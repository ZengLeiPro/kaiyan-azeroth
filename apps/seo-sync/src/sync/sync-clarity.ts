import type { PrismaClient } from '@prisma/client';

import { ClarityClient, type ClarityLiveInsightsResponse } from '../clients/clarity-client';
import { daysAgoBeijing } from '../utils/date';

export interface SyncClarityResult {
  /** Clarity 返回的指标数 */
  metricCount: number;
  /** 实际写入的 (页面+日期) 条数 */
  written: number;
  /** 数据归属日期（YYYY-MM-DD） */
  statDate: string;
}

export interface SyncClarityOptions {
  prisma: PrismaClient;
  clarity: ClarityClient;
  siteUrl: string;
  numOfDays: number;
  dryRun: boolean;
}

/**
 * 拉取 Clarity live-insights 写入 seo_page_insights。
 *
 * Clarity API 返回的是「近 N 天聚合」，不是按日。我们把聚合数据归到「昨天」这个 statDate。
 * 每日 cron 跑一次 numOfDays=1，落"昨天"快照；如果某天 cron 失败，第二天 numOfDays=2 自动补。
 *
 * Clarity 指标说明（按 metricName 取值）：
 *   - Traffic: { totalSessions, totalUsers, pagesPerSession, ... }
 *   - PopularPages: [{ url, sessions, ... }]
 *   - EngagementTime: { activeTime, totalTime, ... }
 *   - ScrollDepth: { averageScrollDepth, ... }
 *   - DeadClickCount: { sessionsWithDeadClick, ... } 等
 *
 * 我们把所有"页面级"信号聚合到 PopularPages 里的 url 维度。其他全局指标（Traffic 等）
 * 作为 siteUrl + "/" 的根记录或者直接落 rawPayload 兜底。
 */
export async function syncClarity(opts: SyncClarityOptions): Promise<SyncClarityResult> {
  console.log(`[sync-clarity] 开始拉 Clarity live-insights numOfDays=${opts.numOfDays}`);

  let raw: ClarityLiveInsightsResponse;
  try {
    raw = await opts.clarity.getLiveInsights(opts.numOfDays);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`[sync-clarity] live-insights 抓取失败: ${msg}`);
  }

  console.log(`[sync-clarity] Clarity 返回 ${raw.length} 个指标`);

  // 我们把数据归到"昨天" statDate（Clarity 聚合的最大 freshness）
  const statDate = daysAgoBeijing(1);
  const statDateObj = new Date(`${statDate}T00:00:00+08:00`);

  // 抽取 PopularPages 作为页面级条目；其他全局指标合入 root page "/"
  const popularPages = raw.find((m) => m.metricName === 'PopularPages')?.information ?? [];
  const traffic = raw.find((m) => m.metricName === 'Traffic')?.information?.[0] ?? {};
  const engagement = raw.find((m) => m.metricName === 'EngagementTime')?.information?.[0] ?? {};
  const scrollDepth = raw.find((m) => m.metricName === 'ScrollDepth')?.information?.[0] ?? {};
  const deadClick = raw.find((m) => m.metricName === 'DeadClickCount')?.information?.[0] ?? {};
  const rageClick = raw.find((m) => m.metricName === 'RageClickCount')?.information?.[0] ?? {};
  const quickback = raw.find((m) => m.metricName === 'QuickbackClickCount')?.information?.[0] ?? {};
  const excessiveScroll =
    raw.find((m) => m.metricName === 'ExcessiveScroll')?.information?.[0] ?? {};
  const scriptError = raw.find((m) => m.metricName === 'ScriptError')?.information?.[0] ?? {};

  // 构造写入条目
  type Row = {
    pageUrl: string;
    sessions: number;
    uniqueUsers: number;
    pageViews: number;
    avgEngagementMs: number | null;
    scrollDepthAvg: number | null;
    deadClicks: number;
    rageClicks: number;
    quickbacks: number;
    excessiveScroll: number;
    jsErrors: number;
    rawPayload: object;
  };

  const rows: Row[] = [];

  // 全站聚合行（pageUrl = "__SITE__"）—— 用于查询整站口径
  // 字段映射依据真实 Clarity v1 响应（2026-05-25 实测）：
  //   Traffic.totalSessionCount / distinctUserCount / pagesPerSessionPercentage / totalBotSessionCount
  //   EngagementTime.activeTime / totalTime
  //   ScrollDepth.averageScrollDepth
  //   <Metric>.subTotal / sessionsCount / pagesViews / sessionsWithMetricPercentage
  const totalSessions = numFrom(traffic, 'totalSessionCount');
  const pagesPerSession = nullableNumFrom(traffic, 'pagesPerSessionPercentage');
  rows.push({
    pageUrl: '__SITE__',
    sessions: totalSessions,
    uniqueUsers: numFrom(traffic, 'distinctUserCount'),
    // Clarity 没有直接的"总 pageViews"字段，取 totalSessions * pagesPerSession 近似
    pageViews: pagesPerSession !== null ? Math.round(totalSessions * pagesPerSession) : 0,
    // 活跃停留秒数（Clarity 给的是秒，不是毫秒；命名保留 Ms 但实际存秒数）
    avgEngagementMs: nullableNumFrom(engagement, 'activeTime'),
    scrollDepthAvg: nullableNumFrom(scrollDepth, 'averageScrollDepth'),
    // 实际事件次数用 subTotal；按 session 计数用 sessionsCount
    deadClicks: numFrom(deadClick, 'subTotal'),
    rageClicks: numFrom(rageClick, 'subTotal'),
    quickbacks: numFrom(quickback, 'subTotal'),
    excessiveScroll: numFrom(excessiveScroll, 'subTotal'),
    jsErrors: numFrom(scriptError, 'subTotal'),
    rawPayload: {
      traffic,
      engagement,
      scrollDepth,
      deadClick,
      rageClick,
      quickback,
      excessiveScroll,
      scriptError,
    },
  });

  // 页面级行（来自 PopularPages）
  // PopularPages 字段：{ url, visitsCount }（v1 实测，2026-05-25）
  for (const p of popularPages) {
    const url = String(p.Url ?? p.url ?? '').slice(0, 500);
    if (!url) continue;
    rows.push({
      pageUrl: url,
      sessions: numFrom(p, 'visitsCount'),
      uniqueUsers: 0, // PopularPages 不细分到 user
      pageViews: numFrom(p, 'visitsCount'), // 一次 visit 至少 1 个 pageView
      avgEngagementMs: null,
      scrollDepthAvg: null,
      deadClicks: 0,
      rageClicks: 0,
      quickbacks: 0,
      excessiveScroll: 0,
      jsErrors: 0,
      rawPayload: p as unknown as object,
    });
  }

  console.log(
    `[sync-clarity] 准备写入 ${rows.length} 条（含 1 行 __SITE__ 聚合 + ${rows.length - 1} 页面）`
  );

  if (opts.dryRun) {
    console.log('[sync-clarity] dry-run 模式，跳过写入');
    return { metricCount: raw.length, written: 0, statDate };
  }

  let written = 0;
  for (const row of rows) {
    await opts.prisma.seoPageInsight.upsert({
      where: {
        uniq_seo_page_insight: {
          source: 'clarity',
          siteUrl: opts.siteUrl,
          statDate: statDateObj,
          pageUrl: row.pageUrl,
        },
      },
      create: {
        source: 'clarity',
        siteUrl: opts.siteUrl,
        statDate: statDateObj,
        ...row,
      },
      update: {
        sessions: row.sessions,
        uniqueUsers: row.uniqueUsers,
        pageViews: row.pageViews,
        avgEngagementMs: row.avgEngagementMs,
        scrollDepthAvg: row.scrollDepthAvg,
        deadClicks: row.deadClicks,
        rageClicks: row.rageClicks,
        quickbacks: row.quickbacks,
        excessiveScroll: row.excessiveScroll,
        jsErrors: row.jsErrors,
        rawPayload: row.rawPayload,
      },
    });
    written += 1;
  }

  console.log(`[sync-clarity] 写入完成 ${written} 条`);
  return { metricCount: raw.length, written, statDate };
}

function numFrom(obj: Record<string, unknown> | undefined, key: string): number {
  if (!obj) return 0;
  const v = obj[key];
  if (typeof v === 'number') return Math.round(v);
  if (typeof v === 'string') {
    const n = Number(v);
    return Number.isFinite(n) ? Math.round(n) : 0;
  }
  return 0;
}

function nullableNumFrom(obj: Record<string, unknown> | undefined, key: string): number | null {
  if (!obj) return null;
  const v = obj[key];
  if (typeof v === 'number') return Math.round(v);
  if (typeof v === 'string') {
    const n = Number(v);
    return Number.isFinite(n) ? Math.round(n) : null;
  }
  return null;
}
