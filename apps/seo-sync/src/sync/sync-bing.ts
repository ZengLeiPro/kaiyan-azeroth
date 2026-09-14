import type { PrismaClient } from '@prisma/client';

import { BingClient, type BingQueryStat } from '../clients/bing-client';
import { formatBeijingDate, parseBingDate } from '../utils/date';

export interface SyncBingResult {
  /** API 返回的原始记录数（含历史 6 个月） */
  fetched: number;
  /** 实际写入数据库的条数（按 source+siteUrl+statDate+query 唯一约束 upsert） */
  written: number;
  /** 时间窗口 */
  fromDate: string;
  toDate: string;
  /** GetUserSites 返回中精确匹配的站点 URL（确权 + 拼写校验） */
  siteMatchedUrl: string;
  /** Bing 后台站点验证状态 */
  siteVerified: boolean;
}

export interface SyncBingOptions {
  prisma: PrismaClient;
  bing: BingClient;
  siteUrl: string;
  dryRun: boolean;
  /**
   * 仅写入 statDate >= fromDate 的数据。
   * 默认 null = 不过滤（首次同步把 Bing 返回的 6 个月历史一次写入）。
   * 后续每日同步建议传昨天的日期，仅追加昨天的新数据。
   */
  fromDate?: string | null;
  /**
   * 是否允许"已验证但 GetQueryStats 返回空数组"算成功。
   * 默认 false：会 throw 让 sync_runs.status 体现异常。
   */
  allowEmptyResult: boolean;
}

/**
 * 拉取 Bing query 统计写入 seo_search_queries。
 *
 * Bing 返回近 6 个月每日聚合数据，新站点可能返回空数组（站点未被收录）。
 * 上线初期会一直空；收录后每日 6 个月窗口滚动。
 */
export async function syncBing(opts: SyncBingOptions): Promise<SyncBingResult> {
  console.log(`[sync-bing] 开始拉取 Bing query stats，site=${opts.siteUrl}`);

  // 0) 站点确权校验：API key 是用户级，必须先用 GetUserSites 确认配置的
  //    siteUrl 在该账号下存在、已验证、且精确匹配（协议/www/尾斜杠任一不一致即不匹配）。
  //    没有这一步，错误的 siteUrl 会让 GetQueryStats 静默返回空数组 → 假成功。
  const sites = await opts.bing.getUserSites();
  const site = sites.find((s) => s.Url === opts.siteUrl);
  if (!site) {
    const known = sites
      .map((s) => `${s.Url}:${s.IsVerified ? 'verified' : 'unverified'}`)
      .join(', ');
    throw new Error(
      `[sync-bing] 当前 API key 下找不到精确匹配站点 ${opts.siteUrl}；已登记站点: ${known || '(空)'}`
    );
  }
  if (!site.IsVerified) {
    throw new Error(
      `[sync-bing] 站点 ${site.Url} 尚未验证；AuthenticationCode=${site.AuthenticationCode ?? '(未知)'}。请在 Bing Webmaster 后台完成验证或重新部署 BingSiteAuth.xml`
    );
  }

  const stats = await opts.bing.getQueryStats();
  console.log(`[sync-bing] Bing 返回 ${stats.length} 条记录`);

  if (stats.length === 0) {
    if (!opts.allowEmptyResult) {
      throw new Error(
        `[sync-bing] GetQueryStats 返回空数组（site=${site.Url}）。站点虽已验证，但当前查询数据为空——可能原因：` +
          `(a) 新站收录滞后，Bing 还未产生搜索表现数据；` +
          `(b) siteUrl 与 Bing 后台已添加的站点拼写不完全一致（即便 GetUserSites 找到了，也建议复核）；` +
          `(c) 此时段 Bing 搜索表现关键词为 0。` +
          `如确认是新站灰度期，请设 SEO_BING_ALLOW_EMPTY_RESULT=true 暂时跳过此校验。`
      );
    }
    return {
      fetched: 0,
      written: 0,
      fromDate: opts.fromDate ?? '',
      toDate: '',
      siteMatchedUrl: site.Url,
      siteVerified: true,
    };
  }

  // 解析日期并过滤
  type Row = BingQueryStat & { statDate: string };
  const rows: Row[] = [];
  let minDate = '9999-12-31';
  let maxDate = '0000-01-01';

  for (const s of stats) {
    const d = parseBingDate(s.Date);
    if (!d) {
      console.warn(`[sync-bing] 无法解析日期: ${s.Date}, query=${s.Query}`);
      continue;
    }
    const statDate = formatBeijingDate(d);
    if (opts.fromDate && statDate < opts.fromDate) continue;
    rows.push({ ...s, statDate });
    if (statDate < minDate) minDate = statDate;
    if (statDate > maxDate) maxDate = statDate;
  }

  console.log(`[sync-bing] 过滤后 ${rows.length} 条待写入 (${minDate} ~ ${maxDate})`);

  if (rows.length === 0) {
    // fetched>0 但 rows=0 通常意味着 Date 解析全部失败（如 Bing 改了日期格式）
    // 或 fromDate 把所有数据都过滤掉了——两种情况都该 throw 让运维察觉
    throw new Error(
      `[sync-bing] API 返回 ${stats.length} 条，但全部无法解析或被 fromDate 过滤；` +
        `fromDate=${opts.fromDate ?? '(null)'}，请检查 Bing Date 字段格式与 parseBingDate 兼容性`
    );
  }

  if (opts.dryRun) {
    console.log('[sync-bing] dry-run 模式，跳过写入');
    return {
      fetched: stats.length,
      written: 0,
      fromDate: minDate,
      toDate: maxDate,
      siteMatchedUrl: site.Url,
      siteVerified: true,
    };
  }

  let written = 0;
  for (const row of rows) {
    const ctr =
      row.Impressions > 0 ? Math.round((row.Clicks / row.Impressions) * 10000) / 10000 : 0;
    // 平均位置：Bing 提供 AvgClickPosition / AvgImpressionPosition，
    // 用 AvgImpressionPosition 作为通用排名（更接近 GSC 的 "average position"）
    const avgPosition = row.AvgImpressionPosition ?? row.AvgClickPosition ?? null;

    await opts.prisma.seoSearchQuery.upsert({
      where: {
        uniq_seo_search_query: {
          source: 'bing',
          siteUrl: opts.siteUrl,
          statDate: new Date(`${row.statDate}T00:00:00+08:00`),
          query: row.Query.slice(0, 500),
        },
      },
      create: {
        source: 'bing',
        siteUrl: opts.siteUrl,
        statDate: new Date(`${row.statDate}T00:00:00+08:00`),
        query: row.Query.slice(0, 500),
        clicks: row.Clicks,
        impressions: row.Impressions,
        avgPosition,
        ctr,
        rawPayload: row as unknown as object,
      },
      update: {
        clicks: row.Clicks,
        impressions: row.Impressions,
        avgPosition,
        ctr,
        rawPayload: row as unknown as object,
      },
    });
    written += 1;
  }

  console.log(`[sync-bing] 写入完成 ${written} 条`);
  return {
    fetched: stats.length,
    written,
    fromDate: minDate,
    toDate: maxDate,
    siteMatchedUrl: site.Url,
    siteVerified: true,
  };
}
