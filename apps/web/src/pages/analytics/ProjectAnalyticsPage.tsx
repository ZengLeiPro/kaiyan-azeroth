import { format } from 'date-fns';
import {
  AlertTriangle,
  Briefcase,
  CheckCircle2,
  Clock,
  DollarSign,
  PlusCircle,
  TrendingUp,
} from 'lucide-react';
import { useState } from 'react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

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
import { KpiCard } from '@/pages/analytics/components/KpiCard';
import { RankingBarChart } from '@/pages/analytics/components/RankingBarChart';

import {
  useProjectDistribution,
  useProjectEffort,
  useProjectKpis,
  useProjectOverdue,
  useProjectTickets,
} from './hooks/use-project-analytics-data';

const fmtAmount = (n: number): string =>
  n.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtHours = (n: number): string => `${n.toFixed(1)}h`;

export default function ProjectAnalyticsPage() {
  const [range, setRange] = useState<AnalyticsRangeValue>({ preset: 'mtd' });
  const [distDim, setDistDim] = useState<'status' | 'category'>('status');

  const kpis = useProjectKpis(range);
  const dist = useProjectDistribution(distDim);
  const effort = useProjectEffort(range);
  const tickets = useProjectTickets(range);
  const overdue = useProjectOverdue();

  return (
    <div className="h-full space-y-6 overflow-auto p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">项目交付盘</h1>
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
          toAnalyticsQueryState('项目分布', dist),
          toAnalyticsQueryState('工时分析', effort),
          toAnalyticsQueryState('工单分析', tickets),
          toAnalyticsQueryState('延期项目', overdue),
        ]}
      />

      {/* 6 KPI */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <KpiCard
          label="在执行项目"
          value={kpis.data?.activeProjectCount ?? '-'}
          icon={Briefcase}
          iconColor="text-blue-600"
          iconBg="bg-blue-100"
          loading={kpis.isLoading}
          error={kpis.isError}
          stale={kpis.isError && kpis.data !== undefined}
        />
        <KpiCard
          label="累计项目"
          value={kpis.data?.totalProjectCount ?? '-'}
          icon={CheckCircle2}
          iconColor="text-emerald-600"
          iconBg="bg-emerald-100"
          loading={kpis.isLoading}
          error={kpis.isError}
          stale={kpis.isError && kpis.data !== undefined}
        />
        <KpiCard
          label="本月新增"
          value={kpis.data?.newProjectCountMtd ?? '-'}
          icon={PlusCircle}
          iconColor="text-violet-600"
          iconBg="bg-violet-100"
          loading={kpis.isLoading}
          error={kpis.isError}
          stale={kpis.isError && kpis.data !== undefined}
        />
        <KpiCard
          label="延期项目"
          value={kpis.data?.overdueProjectCount ?? '-'}
          icon={AlertTriangle}
          iconColor="text-rose-600"
          iconBg="bg-rose-100"
          loading={kpis.isLoading}
          error={kpis.isError}
          stale={kpis.isError && kpis.data !== undefined}
        />
        <KpiCard
          label="期内总工时"
          value={kpis.data ? fmtHours(kpis.data.totalEffortHours) : '-'}
          icon={Clock}
          iconColor="text-amber-600"
          iconBg="bg-amber-100"
          loading={kpis.isLoading}
          error={kpis.isError}
          stale={kpis.isError && kpis.data !== undefined}
        />
        <KpiCard
          label="期内人工成本"
          value={kpis.data ? `￥${fmtAmount(kpis.data.totalLaborCost)}` : '-'}
          hint={kpis.data ? `hourlyRate 覆盖 ${kpis.data.hourlyRateCoverage}% 在职员工` : undefined}
          icon={DollarSign}
          iconColor="text-green-600"
          iconBg="bg-green-100"
          loading={kpis.isLoading}
          error={kpis.isError}
          stale={kpis.isError && kpis.data !== undefined}
        />
      </div>

      {/* 分布 */}
      <ChartCard
        title="项目分布"
        action={
          <Tabs value={distDim} onValueChange={(v) => setDistDim(v as 'status' | 'category')}>
            <TabsList>
              <TabsTrigger value="status">状态</TabsTrigger>
              <TabsTrigger value="category">分类</TabsTrigger>
            </TabsList>
          </Tabs>
        }
        loading={dist.isLoading}
        empty={!dist.data || dist.data.items.length === 0}
        height={300}
      >
        {dist.data && <DistributionPie data={dist.data.items} topN={10} height={280} />}
      </ChartCard>

      {/* 工时四维 */}
      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard
          title="工时按项目 Top"
          loading={effort.isLoading}
          empty={!effort.data || effort.data.byProject.length === 0}
          height={360}
        >
          {effort.data && (
            <RankingBarChart
              data={effort.data.byProject.slice(0, 10).map((p) => ({
                id: p.projectId,
                name: p.projectName,
                value: p.totalHours,
                hint: `${p.participantCount} 人参与`,
              }))}
              limit={10}
            />
          )}
        </ChartCard>

        <ChartCard
          title="人员饱和度"
          action={<span className="text-xs text-muted-foreground">基于 5/7 估算工作日</span>}
          loading={effort.isLoading}
          empty={!effort.data || effort.data.byPerson.length === 0}
          height={360}
        >
          {effort.data && (
            <RankingBarChart
              data={effort.data.byPerson.slice(0, 12).map((p) => ({
                id: p.ownerId,
                name: p.ownerName,
                value: p.totalHours,
                hint: `饱和度 ${(p.saturation * 100).toFixed(0)}%`,
              }))}
              limit={12}
            />
          )}
        </ChartCard>

        <ChartCard
          title="工时按工种"
          loading={effort.isLoading}
          empty={!effort.data || effort.data.byWorkType.length === 0}
          height={300}
        >
          {effort.data && (
            <DistributionPie
              data={effort.data.byWorkType.map((w) => ({
                key: w.workType,
                label: w.workType,
                count: w.totalHours,
                percentage: w.percentage,
              }))}
              topN={8}
              height={280}
            />
          )}
        </ChartCard>

        <ChartCard
          title="工时与成本按客户 Top10"
          loading={effort.isLoading}
          empty={!effort.data || effort.data.byCustomer.length === 0}
          height={360}
        >
          {effort.data && (
            <div className="max-h-80 overflow-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>客户</TableHead>
                    <TableHead className="text-right">工时</TableHead>
                    <TableHead className="text-right">人工成本</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {effort.data.byCustomer.slice(0, 10).map((c) => (
                    <TableRow key={c.customerId}>
                      <TableCell className="font-medium">{c.customerName}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {fmtHours(c.totalHours)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        ￥{fmtAmount(c.totalCost)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </ChartCard>
      </div>

      {/* 工单统计 */}
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="grid grid-cols-2 gap-3 lg:col-span-1">
          {tickets.data && (
            <>
              <KpiCard
                label="待处理"
                value={tickets.data.counts.pending}
                icon={Clock}
                iconColor="text-amber-600"
                iconBg="bg-amber-100"
              />
              <KpiCard
                label="处理中"
                value={tickets.data.counts.inProgress}
                icon={TrendingUp}
                iconColor="text-blue-600"
                iconBg="bg-blue-100"
              />
              <KpiCard
                label="已完成"
                value={tickets.data.counts.completed}
                icon={CheckCircle2}
                iconColor="text-emerald-600"
                iconBg="bg-emerald-100"
              />
              <KpiCard
                label="超期未完"
                value={tickets.data.counts.overdue}
                icon={AlertTriangle}
                iconColor="text-rose-600"
                iconBg="bg-rose-100"
              />
            </>
          )}
        </div>

        <ChartCard
          title="工单类型分布"
          loading={tickets.isLoading}
          empty={!tickets.data || tickets.data.byType.length === 0}
          height={260}
        >
          {tickets.data && <DistributionPie data={tickets.data.byType} topN={6} height={260} />}
        </ChartCard>

        <ChartCard
          title="工单优先级分布"
          loading={tickets.isLoading}
          empty={!tickets.data || tickets.data.byPriority.length === 0}
          height={260}
        >
          {tickets.data && (
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={tickets.data.byPriority}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis dataKey="label" fontSize={12} />
                <YAxis fontSize={12} />
                <Tooltip />
                <Bar dataKey="count" fill="#0ea5e9" name="数量" />
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartCard>
      </div>

      {/* SLA + 平均时长 */}
      <div className="grid gap-4 lg:grid-cols-3">
        <KpiCard
          label="SLA 达成率"
          value={tickets.data ? `${tickets.data.slaRate}%` : '-'}
          hint="completedAt ≤ dueDate / 已完成"
          icon={CheckCircle2}
          iconColor="text-emerald-600"
          iconBg="bg-emerald-100"
          loading={tickets.isLoading}
          error={tickets.isError}
        />
        <KpiCard
          label="平均解决时长"
          value={tickets.data ? `${tickets.data.avgResolutionHours} h` : '-'}
          hint="started → completed"
          icon={Clock}
          iconColor="text-blue-600"
          iconBg="bg-blue-100"
          loading={tickets.isLoading}
          error={tickets.isError}
        />
        <KpiCard
          label="平均闭环时长"
          value={tickets.data ? `${tickets.data.avgClosureHours} h` : '-'}
          hint="created → closed"
          icon={Clock}
          iconColor="text-violet-600"
          iconBg="bg-violet-100"
          loading={tickets.isLoading}
          error={tickets.isError}
        />
      </div>

      {/* 延期项目明细 */}
      <ChartCard
        title={`延期项目明细（共 ${overdue.data?.total ?? 0} 项，展示前 200）`}
        loading={overdue.isLoading}
        empty={!overdue.data || overdue.data.items.length === 0}
        emptyText="暂无延期项目"
        height={400}
      >
        {overdue.data && (
          <div className="max-h-96 overflow-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>项目名称</TableHead>
                  <TableHead>客户</TableHead>
                  <TableHead>负责人</TableHead>
                  <TableHead>状态</TableHead>
                  <TableHead>计划结束</TableHead>
                  <TableHead className="text-right">延期天数</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {overdue.data.items.map((it) => (
                  <TableRow key={it.projectId}>
                    <TableCell className="font-medium">{it.projectName}</TableCell>
                    <TableCell>{it.customerName ?? '-'}</TableCell>
                    <TableCell>{it.ownerName ?? '（未指派）'}</TableCell>
                    <TableCell>{it.status}</TableCell>
                    <TableCell>{format(new Date(it.endDate), 'yyyy-MM-dd')}</TableCell>
                    <TableCell className="text-right tabular-nums">{it.daysOverdue}</TableCell>
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
