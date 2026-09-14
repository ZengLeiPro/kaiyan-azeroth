import { Prisma, PrismaClient } from '@prisma/client';

import { BingClient } from '../clients/bing-client';
import { ClarityClient } from '../clients/clarity-client';
import { GoogleClient, parseServiceAccount } from '../clients/google-client';
import type { SeoSyncConfig } from '../config';
import { syncBing, type SyncBingResult } from './sync-bing';
import { syncClarity, type SyncClarityResult } from './sync-clarity';
import { syncGoogle, type SyncGoogleResult } from './sync-google';

/**
 * 展开 err.cause 链，返回可读的错误描述。
 *
 * Node undici fetch 失败时 err.message 常常只有 `fetch failed`，真实原因（DNS
 * ENOTFOUND、TLS handshake、ETIMEDOUT）藏在 err.cause 里；这里做一层剥离
 * 避免 sync_runs.errors 全部显示 `fetch failed` 无法定位。
 */
function describeError(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  const parts: string[] = [`${err.name}: ${err.message}`];
  // AggregateError（undici IPv4+IPv6 双栈失败常见）：内层 .errors[] 才是真错
  const agg = err as { errors?: unknown };
  if (Array.isArray(agg.errors) && agg.errors.length > 0) {
    parts.push(
      `errors=[${agg.errors
        .slice(0, 3)
        .map((e) =>
          e instanceof Error
            ? `${e.name}(${(e as { code?: string }).code ?? '?'}): ${e.message}`
            : String(e)
        )
        .join(' ; ')}]`
    );
  }
  let cur: unknown = (err as { cause?: unknown }).cause;
  let depth = 0;
  while (cur && depth < 3) {
    if (cur instanceof Error) {
      const code = (cur as { code?: string }).code;
      parts.push(`cause[${depth}]=${cur.name}(${code ?? '?'}): ${cur.message}`);
      const nested = cur as { errors?: unknown };
      if (Array.isArray(nested.errors) && nested.errors.length > 0) {
        parts.push(
          `cause[${depth}].errors=[${nested.errors
            .slice(0, 3)
            .map((e) =>
              e instanceof Error
                ? `${e.name}(${(e as { code?: string }).code ?? '?'}): ${e.message}`
                : String(e)
            )
            .join(' ; ')}]`
        );
      }
      cur = (cur as { cause?: unknown }).cause;
    } else {
      parts.push(`cause[${depth}]=${String(cur)}`);
      break;
    }
    depth += 1;
  }
  return parts.join(' | ');
}

export interface SeoSyncReport {
  bing: SyncBingResult | null;
  clarity: SyncClarityResult | null;
  google: SyncGoogleResult | null;
  errors: Array<{ source: string; stage: string; message: string }>;
  elapsedMs: number;
  runId?: string;
}

/**
 * 主编排：拉 Bing + 拉 Clarity + 落 SeoSyncRun 日志。
 *
 * 任何一步失败都不影响后续步骤；errors 数组聚合所有阶段错误。
 */
export async function runFullSync(
  config: SeoSyncConfig,
  triggerSource: string = 'manual'
): Promise<SeoSyncReport> {
  const startTs = Date.now();
  const errors: SeoSyncReport['errors'] = [];

  const prisma = new PrismaClient({ datasourceUrl: config.databaseUrl });

  // 落一条 running 记录
  let runId: string | null = null;
  if (!config.dryRun) {
    try {
      const run = await prisma.seoSyncRun.create({
        data: {
          triggerSource,
          status: 'running',
          startedAt: new Date(),
          counts: {} as unknown as Prisma.InputJsonValue,
          errors: [] as unknown as Prisma.InputJsonValue,
        },
      });
      runId = run.id;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[engine] 创建 SeoSyncRun 记录失败（继续同步）: ${msg}`);
    }
  }

  let bingResult: SyncBingResult | null = null;
  let clarityResult: SyncClarityResult | null = null;
  let googleResult: SyncGoogleResult | null = null;

  try {
    // 1) Bing
    if (config.bingApiKey) {
      try {
        const bing = new BingClient({
          apiKey: config.bingApiKey,
          siteUrl: config.bingSiteUrl,
          throttleMs: config.throttleMs,
        });
        bingResult = await syncBing({
          prisma,
          bing,
          siteUrl: config.bingSiteUrl,
          dryRun: config.dryRun,
          fromDate: null, // 首次同步拉全量；后续可优化为只拉近 N 天
          allowEmptyResult: config.bingAllowEmptyResult,
        });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[engine] bing 阶段异常: ${msg}`);
        errors.push({ source: 'bing', stage: 'sync', message: msg });
      }
    } else {
      console.log('[engine] 未配置 SEO_BING_API_KEY，跳过 Bing');
    }

    // 2) Clarity
    if (config.clarityApiToken) {
      try {
        const clarity = new ClarityClient({
          apiToken: config.clarityApiToken,
          throttleMs: config.throttleMs,
        });
        clarityResult = await syncClarity({
          prisma,
          clarity,
          siteUrl: config.claritySiteUrl,
          numOfDays: config.clarityNumOfDays,
          dryRun: config.dryRun,
        });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[engine] clarity 阶段异常: ${msg}`);
        errors.push({ source: 'clarity', stage: 'sync', message: msg });
      }
    } else {
      console.log('[engine] 未配置 SEO_CLARITY_API_TOKEN，跳过 Clarity');
    }

    // 3) Google Search Console
    if (config.googleServiceAccountJson) {
      try {
        const sa = parseServiceAccount(config.googleServiceAccountJson);
        const google = new GoogleClient({
          serviceAccount: sa,
          siteUrl: config.googleSiteUrl,
          throttleMs: config.throttleMs,
          httpsProxy: config.googleHttpsProxy,
        });
        googleResult = await syncGoogle({
          prisma,
          google,
          siteUrl: config.googleSiteUrl,
          storageSiteUrl: config.googleStorageSiteUrl,
          numOfDays: config.googleNumOfDays,
          dryRun: config.dryRun,
          allowEmptyResult: config.googleAllowEmptyResult,
        });
      } catch (err: unknown) {
        // fetch 失败时 err.cause 才有真实错误（undici 里 `fetch failed` 太模糊），
        // 把 cause 链一并 stringify 帮排查（DNS 失败 / VPC 出网被拒 / TLS 校验失败）
        const detail = describeError(err);
        console.error(`[engine] google 阶段异常: ${detail}`);
        errors.push({ source: 'google', stage: 'sync', message: detail });
      }
    } else {
      console.log('[engine] 未配置 SEO_GOOGLE_SERVICE_ACCOUNT_JSON，跳过 Google');
    }

    // 4) 百度统计 OpenAPI（待 PV>100 开通后启用，目前 stub）
    // 实现位置：apps/seo-sync/src/sync/sync-baidu-tongji.ts（待添加）
  } finally {
    // 更新 SeoSyncRun 记录
    const elapsedMs = Date.now() - startTs;
    if (runId && !config.dryRun) {
      const hasAnySuccess = bingResult || clarityResult || googleResult;
      const status = errors.length === 0 ? 'success' : hasAnySuccess ? 'partial' : 'failed';
      try {
        await prisma.seoSyncRun.update({
          where: { id: runId },
          data: {
            status,
            finishedAt: new Date(),
            elapsedMs,
            counts: {
              bing: bingResult?.written ?? 0,
              clarity: clarityResult?.written ?? 0,
              google: googleResult?.written ?? 0,
            },
            errors: errors as unknown as Prisma.InputJsonValue,
            report: {
              bing: bingResult,
              clarity: clarityResult,
              google: googleResult,
            } as unknown as Prisma.InputJsonValue,
          },
        });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[engine] 更新 SeoSyncRun 失败: ${msg}`);
      }
    }

    await prisma.$disconnect();
  }

  return {
    bing: bingResult,
    clarity: clarityResult,
    google: googleResult,
    errors,
    elapsedMs: Date.now() - startTs,
    runId: runId ?? undefined,
  };
}
