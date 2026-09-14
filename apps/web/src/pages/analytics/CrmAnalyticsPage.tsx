import {
  AGING_BUCKET_COLORS,
  CRM_RANKING_METRIC_IS_AMOUNT,
  CRM_RANKING_METRIC_LABELS,
  CRM_RANKING_METRICS,
  CRM_TREND_METRIC_IS_AMOUNT,
  CRM_TREND_METRIC_LABELS,
  CRM_TREND_METRICS,
} from '@ky-azeroth/shared/constants';
import { format } from 'date-fns';
import { AlertTriangle, DollarSign, FileText, Receipt, Target, Users } from 'lucide-react';
import { useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toAnalyticsQueryState } from '@/pages/analytics/components/analytics-query-state';
import {
  AnalyticsDateRangePicker,
  type AnalyticsRangeValue,
} from '@/pages/analytics/components/AnalyticsDateRangePicker';
import { AnalyticsQueryStatus } from '@/pages/analytics/components/AnalyticsQueryStatus';
import { ChartCard } from '@/pages/analytics/components/ChartCard';
import { DistributionPie } from '@/pages/analytics/components/DistributionPie';
import { FunnelChart } from '@/pages/analytics/components/FunnelChart';
import { KpiCard } from '@/pages/analytics/components/KpiCard';
import { MetricTrendChart } from '@/pages/analytics/components/MetricTrendChart';
import { RankingBarChart } from '@/pages/analytics/components/RankingBarChart';

import {
  useCrmAging,
  useCrmDistribution,
  useCrmFunnel,
  useCrmKpis,
  useCrmRanking,
  useCrmSleeping,
  useCrmTrend,
} from './hooks/use-crm-analytics-data';

const fmtAmount = (n: number): string =>
  n.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const DISTRIBUTION_DIMENSIONS = [
  { key: 'level', label: '客户等级' },
  { key: 'source', label: '客户来源' },
  { key: 'industry', label: '行业' },
  { key: 'relationship', label: '客户关系' },
] as const;

export default function CrmAnalyticsPage() {
  const [range, setRange] = useState<AnalyticsRangeValue>({ preset: 'mtd' });
  const [trendMetric, setTrendMetric] =
    useState<(typeof CRM_TREND_METRICS)[number]>('payment_amount');
  const [distributionDim, setDistributionDim] = useState<
    'level' | 'source' | 'industry' | 'relationship'
  >('level');
  const [rankingDim, setRankingDim] = useState<'salesperson' | 'customer' | 'product'>(
    'salesperson'
  );
  const [rankingMetric, setRankingMetric] =
    useState<(typeof CRM_RANKING_METRICS)[number]>('paid_amount');

  const kpis = useCrmKpis(range);
  const funnel = useCrmFunnel(range);
  const trend = useCrmTrend(range, trendMetric, 'day');
  const distribution = useCrmDistribution(distributionDim);
  const ranking = useCrmRanking(range, rankingDim, rankingMetric, 10);
  const aging = useCrmAging();
  const sleeping = useCrmSleeping();

  return (
    <div className="h-full space-y-6 overflow-auto p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">CRM 经营盘</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {kpis.data
              ? `数据范围：${kpis.data.range.startDate} ~ ${kpis.data.range.endDate}`
              : kpis.isError
                ? '数据范围加载失败'
                : '加载中...'}
          </p>
        </div>
        <AnalyticsDateRangePicker value={range} onChange={setRange} />
      </div>

      <AnalyticsQueryStatus
        queries={[
          toAnalyticsQueryState('核心指标', kpis),
          toAnalyticsQueryState('商机漏斗', funnel),
          toAnalyticsQueryState('经营趋势', trend),
          toAnalyticsQueryState('客户分布', distribution),
          toAnalyticsQueryState('经营排行', ranking),
          toAnalyticsQueryState('应收账龄', aging),
          toAnalyticsQueryState('沉睡客户', sleeping),
        ]}
      />

      {/* 6 KPI */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <KpiCard
          label="客户数"
          value={kpis.data?.customerCount ?? '-'}
          icon={Users}
          iconColor="text-emerald-600"
          iconBg="bg-emerald-100"
          loading={kpis.isLoading}
          error={kpis.isError}
          stale={kpis.isError && kpis.data !== undefined}
        />
        <KpiCard
          label="商机数"
          value={kpis.data?.opportunityCount ?? '-'}
          icon={Target}
          iconColor="text-blue-600"
          iconBg="bg-blue-100"
          loading={kpis.isLoading}
          error={kpis.isError}
          stale={kpis.isError && kpis.data !== undefined}
        />
        <KpiCard
          label="订单数"
          value={kpis.data?.saleOrderCount ?? '-'}
          icon={FileText}
          iconColor="text-violet-600"
          iconBg="bg-violet-100"
          loading={kpis.isLoading}
          error={kpis.isError}
          stale={kpis.isError && kpis.data !== undefined}
        />
        <KpiCard
          label="回款金额"
          value={kpis.data ? `￥${fmtAmount(kpis.data.paymentAmount)}` : '-'}
          icon={DollarSign}
          iconColor="text-green-600"
          iconBg="bg-green-100"
          loading={kpis.isLoading}
          error={kpis.isError}
          stale={kpis.isError && kpis.data !== undefined}
        />
        <KpiCard
          label="应收金额"
          value={kpis.data ? `￥${fmtAmount(kpis.data.accountsReceivableTotal)}` : '-'}
          icon={Receipt}
          iconColor="text-amber-600"
          iconBg="bg-amber-100"
          loading={kpis.isLoading}
          error={kpis.isError}
          stale={kpis.isError && kpis.data !== undefined}
        />
        <KpiCard
          label="沉睡 SA"
          value={kpis.data?.sleepingSaCount ?? '-'}
          hint="S/A 级 90 天无跟进"
          icon={AlertTriangle}
          iconColor="text-rose-600"
          iconBg="bg-rose-100"
          loading={kpis.isLoading}
          error={kpis.isError}
          stale={kpis.isError && kpis.data !== undefined}
        />
      </div>

      {/* 漏斗 + 分布 */}
      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard
          title="商机阶段漏斗"
          loading={funnel.isLoading}
          empty={!funnel.data || funnel.data.stages.length === 0}
          height={300}
        >
          {funnel.data && <FunnelChart stages={funnel.data.stages} height={300} />}
        </ChartCard>

        <ChartCard
          title="客户分布"
          action={
            <Tabs
              value={distributionDim}
              onValueChange={(v) =>
                setDistributionDim(v as 'level' | 'source' | 'industry' | 'relationship')
              }
            >
              <TabsList>
                {DISTRIBUTION_DIMENSIONS.map((d) => (
                  <TabsTrigger key={d.key} value={d.key}>
                    {d.label}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
          }
          loading={distribution.isLoading}
          empty={!distribution.data || distribution.data.items.length === 0}
          height={300}
        >
          {distribution.data && (
            <DistributionPie data={distribution.data.items} topN={8} height={280} />
          )}
        </ChartCard>
      </div>

      {/* 趋势 + 账龄 */}
      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard
          title="趋势"
          action={
            <Tabs
              value={trendMetric}
              onValueChange={(v) => setTrendMetric(v as (typeof CRM_TREND_METRICS)[number])}
            >
              <TabsList>
                {CRM_TREND_METRICS.map((m) => (
                  <TabsTrigger key={m} value={m}>
                    {CRM_TREND_METRIC_LABELS[m]}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
          }
          loading={trend.isLoading}
          empty={!trend.data || trend.data.points.length === 0}
          height={300}
        >
          {trend.data && (
            <MetricTrendChart
              data={trend.data.points as unknown as Array<Record<string, string | number>>}
              xKey="bucket"
              lines={[
                {
                  key: 'value',
                  name: CRM_TREND_METRIC_LABELS[trendMetric],
                  color: '#2e56e1',
                },
              ]}
              isAmount={CRM_TREND_METRIC_IS_AMOUNT[trendMetric]}
            />
          )}
        </ChartCard>

        <ChartCard
          title="应收账款账龄"
          action={
            aging.data && (
              <span className="text-xs text-muted-foreground">
                合计 {aging.data.total.customerCount} 户 · ￥{fmtAmount(aging.data.total.amount)}
              </span>
            )
          }
          loading={aging.isLoading}
          empty={!aging.data || aging.data.total.amount === 0}
          height={300}
        >
          {aging.data && (
            <ResponsiveContainer width="100%" height={280}>
              <BarChart
                data={aging.data.buckets}
                margin={{ top: 8, right: 16, bottom: 4, left: 0 }}
              >
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis dataKey="label" fontSize={12} />
                <YAxis fontSize={12} />
                <Tooltip formatter={(value: number) => [`￥${fmtAmount(value)}`, '应收金额']} />
                <Bar dataKey="amount" name="金额">
                  {aging.data.buckets.map((b, idx) => (
                    <Cell key={b.label} fill={AGING_BUCKET_COLORS[idx]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartCard>
      </div>

      {/* 排行榜 */}
      <ChartCard
        title="排行榜"
        action={
          <div className="flex items-center gap-2">
            <Tabs
              value={rankingDim}
              onValueChange={(v) => setRankingDim(v as 'salesperson' | 'customer' | 'product')}
            >
              <TabsList>
                <TabsTrigger value="salesperson">销售</TabsTrigger>
                <TabsTrigger value="customer">客户</TabsTrigger>
                <TabsTrigger value="product">产品</TabsTrigger>
              </TabsList>
            </Tabs>
            <Tabs
              value={rankingMetric}
              onValueChange={(v) => setRankingMetric(v as (typeof CRM_RANKING_METRICS)[number])}
            >
              <TabsList>
                {CRM_RANKING_METRICS.map((m) => (
                  <TabsTrigger key={m} value={m}>
                    {CRM_RANKING_METRIC_LABELS[m]}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
          </div>
        }
        loading={ranking.isLoading}
        empty={!ranking.data || ranking.data.items.length === 0}
        height={400}
      >
        {ranking.data && (
          <RankingBarChart
            data={ranking.data.items}
            isAmount={CRM_RANKING_METRIC_IS_AMOUNT[rankingMetric]}
            limit={10}
          />
        )}
      </ChartCard>

      {/* 沉睡客户表 */}
      <ChartCard
        title={`沉睡客户（S/A 级 90 天无跟进，共 ${sleeping.data?.total ?? 0} 户，展示前 200）`}
        loading={sleeping.isLoading}
        empty={!sleeping.data || sleeping.data.items.length === 0}
        height={400}
      >
        {sleeping.data && (
          <div className="max-h-96 overflow-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>客户名称</TableHead>
                  <TableHead>等级</TableHead>
                  <TableHead>负责人</TableHead>
                  <TableHead>最近跟进</TableHead>
                  <TableHead className="text-right">沉睡天数</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sleeping.data.items.map((it) => (
                  <TableRow key={it.customerId}>
                    <TableCell className="font-medium">{it.customerName}</TableCell>
                    <TableCell>{it.customerLevel}</TableCell>
                    <TableCell>{it.chargerName ?? '（未指派）'}</TableCell>
                    <TableCell>
                      {it.lastKeepRecordTime
                        ? format(new Date(it.lastKeepRecordTime), 'yyyy-MM-dd HH:mm')
                        : '从未跟进'}
                    </TableCell>
                    <TableCell className="text-right">{it.daysSinceLastKeep ?? '∞'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </ChartCard>
    </div>
  );
}
