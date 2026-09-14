import { Activity, Clock, Compass, Eye, FileCheck2, Layers, Percent, Users } from 'lucide-react';

import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ChartCard } from '@/pages/analytics/components/ChartCard';
import { KpiCard } from '@/pages/analytics/components/KpiCard';
import { MetricTrendChart } from '@/pages/analytics/components/MetricTrendChart';
import {
  fmtChange,
  fmtDuration,
  fmtNumber,
  fmtPercent,
  TREND_METRICS,
} from '@/pages/analytics/components/web-analytics-presenters';
import type { WebAnalyticsSectionProps } from '@/pages/analytics/components/web-analytics-sections/types';
import {
  useWebAnalyticsSummary,
  useWebAnalyticsTrend,
} from '@/pages/analytics/hooks/use-web-analytics-data';

export function OverviewSection({ dashboard }: WebAnalyticsSectionProps) {
  const { range, effectiveFilters, trendMetric, setTrendMetric } = dashboard;
  const summary = useWebAnalyticsSummary(range, effectiveFilters);
  const trend = useWebAnalyticsTrend(range, effectiveFilters);
  const selectedTrend = TREND_METRICS.find((item) => item.key === trendMetric) ?? TREND_METRICS[0];

  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <KpiCard
          label="PV"
          value={fmtNumber(summary.data?.pv)}
          hint={fmtChange(summary.data?.comparison.pvChangeRate)}
          icon={Eye}
          iconColor="text-blue-600"
          iconBg="bg-blue-100"
          loading={summary.isLoading}
        />
        <KpiCard
          label="UV"
          value={fmtNumber(summary.data?.uv)}
          hint={fmtChange(summary.data?.comparison.uvChangeRate)}
          icon={Users}
          iconColor="text-emerald-600"
          iconBg="bg-emerald-100"
          loading={summary.isLoading}
        />
        <KpiCard
          label="会话"
          value={fmtNumber(summary.data?.sessions)}
          hint={fmtChange(summary.data?.comparison.sessionsChangeRate)}
          icon={Compass}
          iconColor="text-amber-600"
          iconBg="bg-amber-100"
          loading={summary.isLoading}
        />
        <KpiCard
          label="最终留资"
          value={fmtNumber(summary.data?.leadSubmits)}
          hint={`留资会话 ${fmtNumber(summary.data?.leadSessions)} · ${fmtChange(summary.data?.comparison.leadSubmitsChangeRate)}`}
          icon={FileCheck2}
          iconColor="text-rose-600"
          iconBg="bg-rose-100"
          loading={summary.isLoading}
        />
        <KpiCard
          label="留资转化率"
          value={fmtPercent(summary.data?.sessionConversionRate)}
          icon={Percent}
          iconColor="text-violet-600"
          iconBg="bg-violet-100"
          loading={summary.isLoading}
        />
        <KpiCard
          label="跳出率"
          value={fmtPercent(summary.data?.bounceRate)}
          icon={Activity}
          iconColor="text-slate-600"
          iconBg="bg-slate-100"
          loading={summary.isLoading}
        />
        <KpiCard
          label="会话页深"
          value={fmtNumber(summary.data?.avgPagesPerSession)}
          hint="平均每会话浏览页数"
          icon={Layers}
          iconColor="text-cyan-600"
          iconBg="bg-cyan-100"
          loading={summary.isLoading}
        />
        <KpiCard
          label="平均会话时长"
          value={fmtDuration(summary.data?.avgSessionDurationSec)}
          icon={Clock}
          iconColor="text-teal-600"
          iconBg="bg-teal-100"
          loading={summary.isLoading}
        />
      </div>

      {summary.data && (
        <div className="rounded-md border bg-card p-4">
          <h3 className="font-medium">数据诊断</h3>
          <div className="mt-2 space-y-2 text-sm text-muted-foreground">
            {summary.data.dataQuality.utmCampaignCoverage < 1 && (
              <p>
                UTM Campaign 覆盖率不足
                1%，当前活动转化对比不参与业务判断；下一步应统一外部分发链接参数。
              </p>
            )}
            {summary.data.dataQuality.titleCoverage < 95 && (
              <p>页面标题覆盖率低于 95%，需检查未上报 title 的页面或 SPA 路由。</p>
            )}
            {summary.data.lastEventAt &&
              Date.now() - new Date(summary.data.lastEventAt).getTime() > 24 * 60 * 60 * 1000 && (
                <p className="text-rose-600">
                  超过 24 小时没有新事件，请检查埋点或 collector 链路。
                </p>
              )}
            {summary.data.dataQuality.utmCampaignCoverage >= 1 &&
              summary.data.dataQuality.titleCoverage >= 95 && (
                <p>关键字段覆盖正常，当前数据可用于内容与转化分析。</p>
              )}
          </div>
        </div>
      )}

      <ChartCard
        title="趋势"
        action={
          <Tabs
            value={trendMetric}
            onValueChange={(value) => setTrendMetric(value as typeof trendMetric)}
          >
            <TabsList>
              {TREND_METRICS.map((metric) => (
                <TabsTrigger key={metric.key} value={metric.key}>
                  {metric.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        }
        loading={trend.isLoading}
        empty={!trend.data || trend.data.points.length === 0}
        height={320}
      >
        {trend.data && (
          <MetricTrendChart
            data={trend.data.points.map((point) => ({ ...point }))}
            xKey="date"
            lines={[
              { key: selectedTrend.key, name: selectedTrend.label, color: selectedTrend.color },
            ]}
            height={300}
          />
        )}
      </ChartCard>
    </>
  );
}
