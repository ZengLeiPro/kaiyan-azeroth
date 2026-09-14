import { Download, FileCheck2, Percent, Users } from 'lucide-react';

import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ChartCard } from '@/pages/analytics/components/ChartCard';
import { DistributionPie } from '@/pages/analytics/components/DistributionPie';
import { KpiCard } from '@/pages/analytics/components/KpiCard';
import { SimpleFunnel } from '@/pages/analytics/components/SimpleFunnel';
import { fmtNumber, fmtPercent } from '@/pages/analytics/components/web-analytics-presenters';
import type { WebAnalyticsSectionProps } from '@/pages/analytics/components/web-analytics-sections/types';
import {
  useWebAnalyticsBreakdown,
  useWebAnalyticsFunnel,
  useWebAnalyticsSummary,
} from '@/pages/analytics/hooks/use-web-analytics-data';

export function ConversionSection({ dashboard }: WebAnalyticsSectionProps) {
  const { range, effectiveFilters, entryDim, setEntryDim } = dashboard;
  const summary = useWebAnalyticsSummary(range, effectiveFilters);
  const entryDistribution = useWebAnalyticsBreakdown(range, effectiveFilters, entryDim, 10);
  const funnel = useWebAnalyticsFunnel(range, effectiveFilters);

  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label="最终留资"
          value={fmtNumber(summary.data?.leadSubmits)}
          hint="线索表单 + 报价申请 + 咨询留言"
          icon={FileCheck2}
          iconColor="text-rose-600"
          iconBg="bg-rose-100"
          loading={summary.isLoading}
        />
        <KpiCard
          label="留资会话"
          value={fmtNumber(summary.data?.leadSessions)}
          icon={Users}
          iconColor="text-violet-600"
          iconBg="bg-violet-100"
          loading={summary.isLoading}
        />
        <KpiCard
          label="留资转化率"
          value={fmtPercent(summary.data?.sessionConversionRate)}
          icon={Percent}
          iconColor="text-blue-600"
          iconBg="bg-blue-100"
          loading={summary.isLoading}
        />
        <KpiCard
          label="资料下载"
          value={fmtNumber(summary.data?.resourceDownloads)}
          hint="低承诺转化"
          icon={Download}
          iconColor="text-emerald-600"
          iconBg="bg-emerald-100"
          loading={summary.isLoading}
        />
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <ChartCard
          title="转化路径（按会话）"
          description="各阶段按全站会话独立统计；最终留资包含线索表单、报价申请和咨询留言。"
          loading={funnel.isLoading}
          empty={!funnel.data || funnel.data.stages.length === 0}
          height={300}
        >
          {funnel.data && <SimpleFunnel stages={funnel.data.stages} />}
        </ChartCard>

        <ChartCard
          title={entryDim === 'placement' ? '入口位置分布' : '咨询渠道分布'}
          action={
            <Tabs value={entryDim} onValueChange={(value) => setEntryDim(value as typeof entryDim)}>
              <TabsList>
                <TabsTrigger value="placement">位置</TabsTrigger>
                <TabsTrigger value="channel">渠道</TabsTrigger>
              </TabsList>
            </Tabs>
          }
          loading={entryDistribution.isLoading}
          empty={!entryDistribution.data || entryDistribution.data.items.length === 0}
          height={300}
        >
          {entryDistribution.data && (
            <DistributionPie data={entryDistribution.data.items} topN={8} height={280} />
          )}
        </ChartCard>
      </div>
    </>
  );
}
