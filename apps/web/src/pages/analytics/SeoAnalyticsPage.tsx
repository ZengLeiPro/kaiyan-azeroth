import { SEO_PAGE_INSIGHT_SITE_AGGREGATE } from '@ky-azeroth/shared/schemas';
import { useQueryClient } from '@tanstack/react-query';
import { formatDistanceToNowStrict } from 'date-fns';
import { zhCN } from 'date-fns/locale';
import {
  Activity,
  AlertTriangle,
  Eye,
  Link as LinkIcon,
  ListOrdered,
  MousePointerClick,
  Percent,
  Search,
  Users,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';

import { ManualSyncButton } from '@/components/patterns/manual-sync-button';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import { formatDateTimeDisplay } from '@/lib/date-utils';
import {
  AnalyticsDateRangePicker,
  type AnalyticsRangeValue,
} from '@/pages/analytics/components/AnalyticsDateRangePicker';
import { ChartCard } from '@/pages/analytics/components/ChartCard';
import { KpiCard } from '@/pages/analytics/components/KpiCard';
import { MetricTrendChart } from '@/pages/analytics/components/MetricTrendChart';
import { RankingBarChart } from '@/pages/analytics/components/RankingBarChart';

import {
  resolveSeoRange,
  useSeoLatestSyncRun,
  useSeoSearchQueries,
  useSeoSearchRanking,
  useSeoSearchTrend,
  useSeoSiteSummary,
  useSeoSummary,
  useSeoTrafficSnapshots,
} from './hooks/use-seo-analytics-data';

const fmtPercent = (ratio: number | null | undefined): string => {
  if (ratio == null || Number.isNaN(ratio)) return '-';
  return `${(ratio * 100).toFixed(2)}%`;
};

const fmtSeconds = (secs: number | null | undefined): string => {
  if (secs == null || Number.isNaN(secs)) return '-';
  if (secs < 60) return `${secs}s`;
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}m${s}s`;
};

const fmtNumber = (n: number | null | undefined): string => {
  if (n == null || Number.isNaN(n)) return '-';
  return n.toLocaleString('zh-CN');
};

const SEARCH_SOURCE_LABELS: Record<string, string> = {
  google: 'Google Search Console',
  bing: 'Bing Webmaster',
  baidu: '百度搜索资源平台',
  'bing-ai': 'Bing AI',
  'baidu-suggest': '百度联想词',
};

type SyncStatusBadgeMeta = {
  variant: 'default' | 'secondary' | 'destructive' | 'outline';
  label: string;
};

const STATUS_BADGE: Record<string, SyncStatusBadgeMeta> = {
  success: { variant: 'default', label: '成功' },
  partial: { variant: 'secondary', label: '部分成功' },
  failed: { variant: 'destructive', label: '失败' },
  running: { variant: 'outline', label: '进行中' },
};

const STATUS_BADGE_FALLBACK: SyncStatusBadgeMeta = { variant: 'outline', label: '未知' };

/**
 * 排行榜左侧 YAxis 自适应：根据数据中最长 name 的渲染宽度算出 yAxisWidth。
 * - 中文/全角字符 ≈ 12px（fontSize=12），ASCII ≈ 6.6px
 * - 上限 RANKING_AXIS_MAX_WIDTH，避免极端长 URL 把柱图区域挤没
 * - 只有超出上限的 name 才在 JS 层截断成 `…`，其余原样显示（避免无谓的省略号）
 */
const RANKING_AXIS_MAX_WIDTH = 360;
const RANKING_AXIS_FONT_SIZE = 12;
const RANKING_AXIS_PADDING = 16;

const CJK_WIDE_CHAR = /[\u3000-\u9fff\uff00-\uffef]/;
const charPx = (ch: string): number =>
  CJK_WIDE_CHAR.test(ch) ? RANKING_AXIS_FONT_SIZE : RANKING_AXIS_FONT_SIZE * 0.6;

const measureTickWidth = (text: string): number => {
  let w = 0;
  for (const ch of text) w += charPx(ch);
  return w;
};

const truncateToWidth = (text: string, maxPx: number): string => {
  const ellipsisPx = RANKING_AXIS_FONT_SIZE * 0.6;
  let acc = 0;
  let out = '';
  for (const ch of text) {
    const cw = charPx(ch);
    if (acc + cw + ellipsisPx > maxPx) break;
    out += ch;
    acc += cw;
  }
  return out + '…';
};

interface RankingSourceItem {
  id: string;
  name: string;
  value: number;
  hint?: string | null;
}

const buildRankingProps = (items: readonly RankingSourceItem[]) => {
  const innerCap = RANKING_AXIS_MAX_WIDTH - RANKING_AXIS_PADDING;
  const widest = items.reduce((max, it) => Math.max(max, measureTickWidth(it.name)), 0);
  const yAxisWidth = Math.min(Math.ceil(widest) + RANKING_AXIS_PADDING, RANKING_AXIS_MAX_WIDTH);
  return {
    yAxisWidth,
    data: items.map((it) => ({
      id: it.id,
      name: measureTickWidth(it.name) > innerCap ? truncateToWidth(it.name, innerCap) : it.name,
      value: it.value,
      hint: it.hint ?? undefined,
    })),
  };
};

export default function SeoAnalyticsPage() {
  const queryClient = useQueryClient();
  const [range, setRange] = useState<AnalyticsRangeValue>({ preset: 'last30d' });
  const [rankingDim, setRankingDim] = useState<'keyword' | 'page'>('keyword');

  /**
   * 手动同步成功后刷新所有 SEO 数据：
   * 整个看板的 queryKey 都以 ['analytics', 'seo'] 开头（包括 latest banner），
   * 一次 invalidate 即可同时刷新 banner / KPI / 趋势 / 排行 / 明细。
   */
  const handleSyncSuccess = () => {
    void queryClient.invalidateQueries({ queryKey: ['analytics', 'seo'] });
  };

  // 关键词搜索 debounce：300ms + trim + 至少 2 个字符再发送
  const [keywordInput, setKeywordInput] = useState('');
  const debouncedKeyword = useDebouncedValue(keywordInput.trim(), 300);
  const effectiveKeyword = debouncedKeyword.length >= 2 ? debouncedKeyword : '';

  const resolvedRange = useMemo(() => resolveSeoRange(range), [range]);

  // 聚合端点（看板专用，后端 groupBy）
  const summary = useSeoSummary(range);
  const searchTrend = useSeoSearchTrend(range);
  const siteSummary = useSeoSiteSummary(range);
  const ranking = useSeoSearchRanking(range, rankingDim, 15);

  // 明细列表：仅关键词表用（带 keyword 搜索）
  const searchQueries = useSeoSearchQueries(range, {
    keyword: effectiveKeyword || undefined,
    pageSize: 200,
  });

  const trafficSnapshots = useSeoTrafficSnapshots(range);
  const latestSync = useSeoLatestSyncRun();

  const lastSync = latestSync.data;
  const lastSyncBadge = lastSync ? (STATUS_BADGE[lastSync.status] ?? STATUS_BADGE_FALLBACK) : null;

  const search = summary.data?.search;
  const clarity = summary.data?.clarity;
  const searchSourceHint =
    summary.data?.searchSources
      .map((item) => SEARCH_SOURCE_LABELS[item.source] ?? item.source)
      .join(' + ') || '暂无搜索表现数据';

  return (
    <div className="h-full space-y-6 overflow-auto p-6">
      {/* ① 头 */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">SEO 数据看板</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            数据范围：{resolvedRange.startDate} ~ {resolvedRange.endDate}
            <span className="ml-2 text-xs">
              · Google 总量与落地页使用 GSC 权威维度；具名关键词受匿名化影响，仅作诊断
            </span>
          </p>
        </div>
        <AnalyticsDateRangePicker value={range} onChange={setRange} />
      </div>

      {/* ② 上次同步 banner */}
      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 text-sm">
          <div className="flex items-center gap-2">
            <Activity className="h-4 w-4 text-muted-foreground" />
            <span className="text-muted-foreground">上次同步：</span>
            {latestSync.isLoading ? (
              <span>加载中...</span>
            ) : lastSync ? (
              <>
                <span className="font-medium" title={formatDateTimeDisplay(lastSync.startedAt)}>
                  {formatDistanceToNowStrict(new Date(lastSync.startedAt), {
                    addSuffix: true,
                    locale: zhCN,
                  })}
                </span>
                {lastSyncBadge && (
                  <Badge variant={lastSyncBadge.variant}>{lastSyncBadge.label}</Badge>
                )}
                <span className="text-xs text-muted-foreground">
                  耗时{' '}
                  {lastSync.elapsedMs != null ? `${(lastSync.elapsedMs / 1000).toFixed(1)}s` : '-'}·
                  Google {lastSync.counts.google ?? 0} / Bing {lastSync.counts.bing ?? 0} / Clarity{' '}
                  {lastSync.counts.clarity ?? 0} / 百度 {lastSync.counts.baiduTongji ?? 0}
                </span>
              </>
            ) : (
              <span className="text-muted-foreground">暂无同步记录</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <ManualSyncButton
              endpoint="/seo/sync-runs/trigger"
              label="立即同步"
              requireAdmin={false}
              onSuccess={handleSyncSuccess}
              successMessage={(d) =>
                `同步完成：共 ${d.count} 条 · 耗时 ${
                  d.durationMs != null ? `${(d.durationMs / 1000).toFixed(1)}s` : '-'
                }`
              }
              errorFallback="SEO 同步失败"
            />
            <Link to="/analytics/seo/sync-runs">
              <Button variant="ghost" size="sm">
                查看同步日志
              </Button>
            </Link>
          </div>
        </CardContent>
      </Card>

      {/* ③ 6 KPI（全部来自 /seo/summary 后端聚合，不再前端拉明细算） */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <KpiCard
          label="总曝光"
          value={fmtNumber(search?.totalImpressions)}
          hint={searchSourceHint}
          icon={Eye}
          iconColor="text-blue-600"
          iconBg="bg-blue-100"
          loading={summary.isLoading}
        />
        <KpiCard
          label="总点击"
          value={fmtNumber(search?.totalClicks)}
          hint={searchSourceHint}
          icon={MousePointerClick}
          iconColor="text-green-600"
          iconBg="bg-green-100"
          loading={summary.isLoading}
        />
        <KpiCard
          label="平均 CTR"
          value={fmtPercent(search?.avgCtr)}
          hint="按曝光加权"
          icon={Percent}
          iconColor="text-violet-600"
          iconBg="bg-violet-100"
          loading={summary.isLoading}
        />
        <KpiCard
          label="平均排名"
          value={search?.avgPosition != null ? search.avgPosition.toFixed(2) : '-'}
          hint="按曝光加权 · 越小越好"
          icon={ListOrdered}
          iconColor="text-amber-600"
          iconBg="bg-amber-100"
          loading={summary.isLoading}
        />
        <KpiCard
          label="Clarity 会话数"
          value={fmtNumber(clarity?.totalSessions)}
          hint={clarity ? `全站行 ${clarity.siteDays} 天` : ''}
          icon={Users}
          iconColor="text-cyan-600"
          iconBg="bg-cyan-100"
          loading={summary.isLoading}
        />
        <KpiCard
          label="JS 错误数"
          value={fmtNumber(clarity?.totalJsErrors)}
          hint="期间累计"
          icon={AlertTriangle}
          iconColor="text-rose-600"
          iconBg="bg-rose-100"
          loading={summary.isLoading}
        />
      </div>

      {/* ④ 双趋势图：搜索曝光/点击 + 用户行为（Clarity __SITE__） */}
      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard
          title="搜索曝光 / 点击趋势"
          loading={searchTrend.isLoading}
          empty={!searchTrend.data || searchTrend.data.points.length === 0}
          height={300}
        >
          {searchTrend.data && (
            <MetricTrendChart
              data={searchTrend.data.points.map((p) => ({
                date: p.date,
                impressions: p.impressions,
                clicks: p.clicks,
              }))}
              xKey="date"
              lines={[
                { key: 'impressions', name: '曝光', color: '#2e56e1' },
                { key: 'clicks', name: '点击', color: '#22c55e' },
              ]}
              height={280}
            />
          )}
        </ChartCard>

        <ChartCard
          title="Clarity 用户行为趋势"
          loading={siteSummary.isLoading}
          empty={!siteSummary.data || siteSummary.data.points.length === 0}
          height={300}
        >
          {siteSummary.data && (
            <MetricTrendChart
              data={siteSummary.data.points.map((p) => ({
                date: p.date,
                sessions: p.sessions,
                scrollDepthAvg: p.scrollDepthAvg ?? 0,
                rageClicks: p.rageClicks,
              }))}
              xKey="date"
              lines={[
                { key: 'sessions', name: '会话数', color: '#0ea5e9' },
                { key: 'scrollDepthAvg', name: '平均滚动深度', color: '#a855f7' },
                { key: 'rageClicks', name: '暴怒点击', color: '#ef4444' },
              ]}
              height={280}
            />
          )}
        </ChartCard>
      </div>

      {/* ⑤ 排行榜 Tabs（关键词为具名查询，落地页为 Google page 权威维度） */}
      <ChartCard
        title="排行榜 Top 15"
        action={
          <Tabs value={rankingDim} onValueChange={(v) => setRankingDim(v as 'keyword' | 'page')}>
            <TabsList>
              <TabsTrigger value="keyword">具名关键词</TabsTrigger>
              <TabsTrigger value="page">Google 搜索落地页</TabsTrigger>
            </TabsList>
          </Tabs>
        }
        loading={ranking.isLoading}
        empty={!ranking.data || ranking.data.items.length === 0}
        height={420}
      >
        {ranking.data && (
          <RankingBarChart {...buildRankingProps(ranking.data.items)} limit={15} height={400} />
        )}
      </ChartCard>

      {/* ⑥ 关键词明细表（明细列表 + keyword debounce 模糊搜索） */}
      <ChartCard
        title={
          searchQueries.data
            ? `关键词明细（共 ${searchQueries.data.total} 条，最多展示 ${searchQueries.data.items.length}）`
            : '关键词明细'
        }
        action={
          <div className="flex items-center gap-2">
            <Search className="h-4 w-4 text-muted-foreground" />
            <Input
              value={keywordInput}
              onChange={(e) => setKeywordInput(e.target.value)}
              placeholder="按关键词模糊搜索（≥2 字）"
              className="h-8 w-48"
            />
          </div>
        }
        loading={searchQueries.isLoading}
        empty={!searchQueries.data || searchQueries.data.items.length === 0}
        height={420}
      >
        <div className="max-h-96 overflow-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>关键词</TableHead>
                <TableHead>来源</TableHead>
                <TableHead className="w-28">日期</TableHead>
                <TableHead className="text-right">曝光</TableHead>
                <TableHead className="text-right">点击</TableHead>
                <TableHead className="text-right">CTR</TableHead>
                <TableHead className="text-right">平均排名</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {searchQueries.data?.items.map((k) => (
                <TableRow key={k.id}>
                  <TableCell className="font-medium">{k.query}</TableCell>
                  <TableCell>{SEARCH_SOURCE_LABELS[k.source] ?? k.source}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{k.statDate}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {fmtNumber(k.impressions)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{fmtNumber(k.clicks)}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {fmtPercent(k.ctr != null ? Number(k.ctr) : null)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {k.avgPosition != null ? Number(k.avgPosition).toFixed(2) : '-'}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </ChartCard>

      {/* ⑦ 百度统计区（空表兜底） */}
      <Card>
        <CardContent className="p-5">
          <div className="mb-2 flex items-center gap-2">
            <LinkIcon className="h-4 w-4 text-muted-foreground" />
            <h3 className="text-base font-semibold">百度统计 · 整站快照</h3>
            <span className="ml-2 text-xs text-muted-foreground">
              （Clarity 全站行哨兵：{SEO_PAGE_INSIGHT_SITE_AGGREGATE}）
            </span>
          </div>
          {trafficSnapshots.isLoading ? (
            <p className="text-sm text-muted-foreground">加载中...</p>
          ) : (trafficSnapshots.data?.items.length ?? 0) > 0 ? (
            <div className="max-h-64 overflow-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>日期</TableHead>
                    <TableHead className="text-right">PV</TableHead>
                    <TableHead className="text-right">UV</TableHead>
                    <TableHead className="text-right">IP</TableHead>
                    <TableHead className="text-right">跳出率</TableHead>
                    <TableHead className="text-right">平均停留</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {trafficSnapshots.data!.items.map((t) => (
                    <TableRow key={t.id}>
                      <TableCell>{t.statDate}</TableCell>
                      <TableCell className="text-right tabular-nums">{fmtNumber(t.pv)}</TableCell>
                      <TableCell className="text-right tabular-nums">{fmtNumber(t.uv)}</TableCell>
                      <TableCell className="text-right tabular-nums">{fmtNumber(t.ip)}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {fmtPercent(t.bounceRate != null ? Number(t.bounceRate) : null)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {fmtSeconds(t.avgVisitTime)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              百度统计 OpenAPI 待站点 PV &gt; 100 开通后启用，当前永远 0 条；上线后此区将自动展示 PV
              / UV / 跳出率 / 来源细分。
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
