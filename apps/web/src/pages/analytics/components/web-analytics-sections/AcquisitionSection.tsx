import { WEB_ANALYTICS_BREAKDOWN_DIMENSION_LABELS } from '@ky-azeroth/shared/constants';
import { UserPlus, Users } from 'lucide-react';

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ChartCard } from '@/pages/analytics/components/ChartCard';
import { DistributionPie } from '@/pages/analytics/components/DistributionPie';
import { EngineLandingHeatmap } from '@/pages/analytics/components/EngineLandingHeatmap';
import { RankingBarChart } from '@/pages/analytics/components/RankingBarChart';
import {
  fmtNumber,
  fmtPercent,
  SOURCE_DIMS,
  toRankingItems,
} from '@/pages/analytics/components/web-analytics-presenters';
import type { WebAnalyticsSectionProps } from '@/pages/analytics/components/web-analytics-sections/types';
import {
  useWebAnalyticsAttribution,
  useWebAnalyticsBreakdown,
  useWebAnalyticsCampaignConversion,
  useWebAnalyticsEngineLandingMatrix,
  useWebAnalyticsLandingPages,
  useWebAnalyticsVisitorType,
} from '@/pages/analytics/hooks/use-web-analytics-data';

export function AcquisitionSection({ dashboard }: WebAnalyticsSectionProps) {
  const {
    range,
    effectiveFilters,
    pageRankFilters,
    sourceDim,
    setSourceDim,
    pageScope,
    setPageScope,
  } = dashboard;
  const sourceRanking = useWebAnalyticsBreakdown(range, effectiveFilters, sourceDim, 15);
  const pageRanking = useWebAnalyticsBreakdown(range, pageRankFilters, 'path', 15);
  const attribution = useWebAnalyticsAttribution(range, effectiveFilters, 20);
  const campaignConversion = useWebAnalyticsCampaignConversion(range, effectiveFilters, 20);
  const landingPages = useWebAnalyticsLandingPages(range, effectiveFilters, 20);
  const engineLandingMatrix = useWebAnalyticsEngineLandingMatrix(range, effectiveFilters, 15);
  const visitorType = useWebAnalyticsVisitorType(range, effectiveFilters);

  return (
    <>
      <div className="grid gap-4 xl:grid-cols-2">
        <ChartCard
          title={WEB_ANALYTICS_BREAKDOWN_DIMENSION_LABELS[sourceDim]}
          action={
            <Tabs
              value={sourceDim}
              onValueChange={(value) => setSourceDim(value as (typeof SOURCE_DIMS)[number]['key'])}
            >
              <TabsList>
                {SOURCE_DIMS.map((dim) => (
                  <TabsTrigger key={dim.key} value={dim.key}>
                    {dim.label}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
          }
          loading={sourceRanking.isLoading}
          empty={!sourceRanking.data || sourceRanking.data.items.length === 0}
          height={360}
        >
          {sourceRanking.data && (
            <RankingBarChart
              data={toRankingItems(sourceRanking.data.items)}
              limit={15}
              height={330}
              yAxisWidth={200}
            />
          )}
        </ChartCard>

        <ChartCard
          title="热门页面"
          action={
            <Tabs
              value={pageScope}
              onValueChange={(value) => setPageScope(value as typeof pageScope)}
            >
              <TabsList>
                <TabsTrigger value="all">全部</TabsTrigger>
                <TabsTrigger value="blog">博客</TabsTrigger>
              </TabsList>
            </Tabs>
          }
          loading={pageRanking.isLoading}
          empty={!pageRanking.data || pageRanking.data.items.length === 0}
          height={360}
        >
          {pageRanking.data && (
            <RankingBarChart
              data={toRankingItems(pageRanking.data.items)}
              limit={15}
              height={330}
              yAxisWidth={220}
            />
          )}
        </ChartCard>
      </div>
      <>
        <ChartCard
          title="首触点归因"
          loading={attribution.isLoading}
          empty={!attribution.data || attribution.data.items.length === 0}
          height={360}
        >
          {attribution.data && (
            <div className="max-h-[360px] overflow-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>来源</TableHead>
                    <TableHead>媒介</TableHead>
                    <TableHead>落地页</TableHead>
                    <TableHead className="text-right">会话</TableHead>
                    <TableHead className="text-right">最终留资</TableHead>
                    <TableHead className="text-right">留资率</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {attribution.data.items.map((item) => (
                    <TableRow key={`${item.source}|${item.medium}|${item.landingPath}`}>
                      <TableCell className="font-medium">{item.source}</TableCell>
                      <TableCell>{item.medium}</TableCell>
                      <TableCell className="max-w-[420px] truncate" title={item.landingPath}>
                        {item.landingPath}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {fmtNumber(item.sessions)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {fmtNumber(item.leadSessions)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {fmtPercent(item.conversionRate)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </ChartCard>

        <ChartCard
          title="UTM 活动转化对比"
          description="按 utm_campaign 看会话→最终留资→留资率。当前无 campaign 数据时应先修分发链接规范，不把空图表误当业务结论。"
          loading={campaignConversion.isLoading}
          empty={!campaignConversion.data || campaignConversion.data.items.length === 0}
          height={360}
        >
          {campaignConversion.data &&
            (() => {
              const maxRate = Math.max(
                1,
                ...campaignConversion.data.items.map((item) => item.conversionRate)
              );
              return (
                <div className="max-h-[360px] overflow-auto rounded-md border">
                  <Table>
                    <TableHeader className="sticky top-0 z-10 bg-card">
                      <TableRow>
                        <TableHead>Campaign</TableHead>
                        <TableHead className="text-right">会话</TableHead>
                        <TableHead className="text-right">最终留资</TableHead>
                        <TableHead className="text-right">留资率</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {campaignConversion.data.items.map((item) => (
                        <TableRow key={item.campaign}>
                          <TableCell
                            className="max-w-[320px] truncate font-medium"
                            title={item.campaign}
                          >
                            {item.campaign}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {fmtNumber(item.sessions)}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {fmtNumber(item.leadSessions)}
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center justify-end gap-2">
                              <div className="h-1.5 w-20 overflow-hidden rounded bg-muted">
                                <div
                                  className="h-full rounded bg-violet-500"
                                  style={{
                                    width: `${Math.min(100, (item.conversionRate / maxRate) * 100)}%`,
                                  }}
                                />
                              </div>
                              <span className="w-14 text-right tabular-nums">
                                {fmtPercent(item.conversionRate)}
                              </span>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              );
            })()}
        </ChartCard>
      </>
      <div className="grid gap-4 xl:grid-cols-2">
        <ChartCard
          title="入口页报告"
          description="按会话首个 pageview 聚合（区别于按 PV 的热门页面）= SEO 真实流量门户。"
          loading={landingPages.isLoading}
          empty={!landingPages.data || landingPages.data.items.length === 0}
          height={360}
        >
          {landingPages.data && (
            <div className="max-h-[360px] overflow-auto rounded-md border">
              <Table>
                <TableHeader className="sticky top-0 z-10 bg-card">
                  <TableRow>
                    <TableHead>入口页</TableHead>
                    <TableHead className="text-right">入口会话</TableHead>
                    <TableHead className="text-right">跳出率</TableHead>
                    <TableHead className="text-right">留资转化</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {landingPages.data.items.map((item) => (
                    <TableRow key={item.landingPath}>
                      <TableCell>
                        <div
                          className="max-w-[320px] truncate font-medium"
                          title={item.title ?? item.landingPath}
                        >
                          {item.title ?? item.landingPath}
                        </div>
                        <div
                          className="max-w-[320px] truncate text-xs text-muted-foreground"
                          title={item.landingPath}
                        >
                          {item.landingPath}
                        </div>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {fmtNumber(item.entrySessions)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {fmtPercent(item.bounceRate)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {fmtPercent(item.conversionRate)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </ChartCard>

        <ChartCard
          title="新访客 vs 回访"
          description="vid 全历史首现判定。受 Safari ITP/隐私模式影响，新访客为乐观估计。"
          loading={visitorType.isLoading}
          empty={
            !visitorType.data ||
            visitorType.data.newVisitors + visitorType.data.returningVisitors === 0
          }
          height={360}
        >
          {visitorType.data && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-md border p-3">
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <UserPlus className="h-4 w-4 text-emerald-600" />
                    新访客占比
                  </div>
                  <div className="mt-1 text-2xl font-bold tabular-nums">
                    {fmtPercent(visitorType.data.newVisitorRate)}
                  </div>
                </div>
                <div className="rounded-md border p-3">
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Users className="h-4 w-4 text-sky-600" />
                    回访访客
                  </div>
                  <div className="mt-1 text-2xl font-bold tabular-nums">
                    {fmtNumber(visitorType.data.returningVisitors)}
                  </div>
                </div>
              </div>
              <DistributionPie
                data={[
                  {
                    key: 'new',
                    label: '新访客',
                    count: visitorType.data.newVisitors,
                    percentage: visitorType.data.newVisitorRate,
                  },
                  {
                    key: 'returning',
                    label: '老访客',
                    count: visitorType.data.returningVisitors,
                    percentage: Math.round((100 - visitorType.data.newVisitorRate) * 100) / 100,
                  },
                ]}
                topN={2}
                height={220}
              />
            </div>
          )}
        </ChartCard>
      </div>
      <ChartCard
        title="搜索引擎 × 落地页 热力下钻"
        description="行=入口页 · 列=搜索引擎 · 单元格=会话数（每行独立归一化，颜色越深代表该引擎占该入口页比例越高）。决策：针对哪个引擎优化哪一篇。"
        loading={engineLandingMatrix.isLoading}
        empty={
          !engineLandingMatrix.data ||
          engineLandingMatrix.data.rows.length === 0 ||
          engineLandingMatrix.data.engines.length === 0
        }
      >
        {engineLandingMatrix.data && <EngineLandingHeatmap data={engineLandingMatrix.data} />}
      </ChartCard>
    </>
  );
}
