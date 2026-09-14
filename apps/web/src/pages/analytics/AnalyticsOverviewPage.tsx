import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Briefcase,
  Clock,
  DollarSign,
  FileText,
  Users,
} from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { toAnalyticsQueryState } from '@/pages/analytics/components/analytics-query-state';
import {
  AnalyticsDateRangePicker,
  type AnalyticsRangeValue,
} from '@/pages/analytics/components/AnalyticsDateRangePicker';
import { AnalyticsQueryStatus } from '@/pages/analytics/components/AnalyticsQueryStatus';
import { ChartCard } from '@/pages/analytics/components/ChartCard';
import { FunnelChart } from '@/pages/analytics/components/FunnelChart';
import { KpiCard } from '@/pages/analytics/components/KpiCard';
import { RankingBarChart } from '@/pages/analytics/components/RankingBarChart';

import { useAnalyticsOverview } from './hooks/use-analytics-overview-data';

const fmtAmount = (n: number): string =>
  n.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function AnalyticsOverviewPage() {
  const [range, setRange] = useState<AnalyticsRangeValue>({ preset: 'mtd' });
  const overview = useAnalyticsOverview(range);
  const { data, isLoading, isError } = overview;

  return (
    <div className="h-full space-y-6 overflow-auto p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">数据分析 · 总览</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {data
              ? `数据范围：${data.range.startDate} ~ ${data.range.endDate}`
              : isError
                ? '数据范围加载失败'
                : '加载中...'}
          </p>
        </div>
        <AnalyticsDateRangePicker value={range} onChange={setRange} />
      </div>

      <AnalyticsQueryStatus queries={[toAnalyticsQueryState('经营总览', overview)]} />

      {/* 6 KPI */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <KpiCard
          label="期内新客"
          value={data?.kpis.newCustomersCount ?? '-'}
          icon={Users}
          iconColor="text-blue-600"
          iconBg="bg-blue-100"
          loading={isLoading}
          error={isError}
          stale={isError && data !== undefined}
        />
        <KpiCard
          label="期内回款"
          value={data ? `￥${fmtAmount(data.kpis.paymentAmount)}` : '-'}
          icon={DollarSign}
          iconColor="text-green-600"
          iconBg="bg-green-100"
          loading={isLoading}
          error={isError}
          stale={isError && data !== undefined}
        />
        <KpiCard
          label="期内新签订单"
          value={data ? `￥${fmtAmount(data.kpis.newOrderAmount)}` : '-'}
          icon={FileText}
          iconColor="text-violet-600"
          iconBg="bg-violet-100"
          loading={isLoading}
          error={isError}
          stale={isError && data !== undefined}
        />
        <KpiCard
          label="在执行项目"
          value={data?.kpis.activeProjectCount ?? '-'}
          icon={Briefcase}
          iconColor="text-amber-600"
          iconBg="bg-amber-100"
          loading={isLoading}
          error={isError}
          stale={isError && data !== undefined}
        />
        <KpiCard
          label="期内总工时"
          value={data ? `${data.kpis.totalEffortHours.toFixed(1)}h` : '-'}
          icon={Clock}
          iconColor="text-cyan-600"
          iconBg="bg-cyan-100"
          loading={isLoading}
          error={isError}
          stale={isError && data !== undefined}
        />
        <KpiCard
          label="日均跟进"
          value={data ? data.kpis.dailyKeepRecordAvg.toFixed(1) : '-'}
          icon={Activity}
          iconColor="text-emerald-600"
          iconBg="bg-emerald-100"
          loading={isLoading}
          error={isError}
          stale={isError && data !== undefined}
        />
      </div>

      {/* 三盘缩略图 */}
      <div className="grid gap-4 lg:grid-cols-3">
        <ChartCard
          title="CRM 漏斗 mini"
          action={
            <Link to="/analytics/crm">
              <Button size="sm" variant="ghost">
                详情 <ArrowRight className="ml-1 h-3 w-3" />
              </Button>
            </Link>
          }
          loading={isLoading}
          empty={!data || data.crmFunnelMini.length === 0}
          height={260}
        >
          {data && <FunnelChart stages={data.crmFunnelMini} height={240} />}
        </ChartCard>

        <ChartCard
          title="项目工时 Top5"
          action={
            <Link to="/analytics/projects">
              <Button size="sm" variant="ghost">
                详情 <ArrowRight className="ml-1 h-3 w-3" />
              </Button>
            </Link>
          }
          loading={isLoading}
          empty={!data || data.projectEffortMini.length === 0}
          height={260}
        >
          {data && (
            <RankingBarChart
              data={data.projectEffortMini.map((p) => ({
                id: p.projectId,
                name: p.projectName,
                value: p.hours,
              }))}
              limit={5}
            />
          )}
        </ChartCard>

        <ChartCard
          title="近 14 天 DAU"
          action={
            <Link to="/analytics/organization">
              <Button size="sm" variant="ghost">
                详情 <ArrowRight className="ml-1 h-3 w-3" />
              </Button>
            </Link>
          }
          loading={isLoading}
          empty={!data || data.dauTrend.length === 0}
          height={260}
        >
          {data && (
            <ResponsiveContainer width="100%" height={240}>
              <LineChart data={data.dauTrend} margin={{ top: 8, right: 8, bottom: 4, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis dataKey="bucket" fontSize={10} />
                <YAxis fontSize={10} />
                <Tooltip />
                <Line
                  type="monotone"
                  dataKey="value"
                  stroke="#2e56e1"
                  dot={false}
                  strokeWidth={2}
                  name="DAU"
                />
              </LineChart>
            </ResponsiveContainer>
          )}
        </ChartCard>
      </div>

      {/* 异常告警 */}
      <Card className="border-amber-200 bg-amber-50/40">
        <CardContent className="p-5">
          <div className="mb-3 flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-amber-600" />
            <h3 className="text-base font-semibold">异常告警</h3>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <Link
              to="/analytics/crm"
              className="rounded-md border bg-white p-3 transition hover:border-amber-400"
            >
              <p className="text-xs text-muted-foreground">沉睡 S/A 级客户</p>
              <p className="mt-1 text-2xl font-bold tabular-nums text-rose-600">
                {data?.alerts.sleepingSaCount ?? '-'}
              </p>
              <p className="text-xs text-muted-foreground">90 天未跟进</p>
            </Link>
            <Link
              to="/analytics/projects"
              className="rounded-md border bg-white p-3 transition hover:border-amber-400"
            >
              <p className="text-xs text-muted-foreground">延期项目</p>
              <p className="mt-1 text-2xl font-bold tabular-nums text-rose-600">
                {data?.alerts.overdueProjectCount ?? '-'}
              </p>
              <p className="text-xs text-muted-foreground">endDate 已过且未完成</p>
            </Link>
            <Link
              to="/analytics/organization"
              className="rounded-md border bg-white p-3 transition hover:border-amber-400"
            >
              <p className="text-xs text-muted-foreground">堆积审批</p>
              <p className="mt-1 text-2xl font-bold tabular-nums text-rose-600">
                {data?.alerts.pendingApprovalCount ?? '-'}
              </p>
              <p className="text-xs text-muted-foreground">所有待审任务</p>
            </Link>
          </div>
        </CardContent>
      </Card>

      {/* 三盘入口卡 */}
      <div className="grid gap-4 sm:grid-cols-3">
        <Link to="/analytics/crm">
          <Card className="transition hover:border-primary hover:shadow-md">
            <CardContent className="p-5">
              <h3 className="text-base font-semibold">CRM 经营盘</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                客户/商机/订单/回款 + 漏斗 + 排行 + 沉睡客户
              </p>
            </CardContent>
          </Card>
        </Link>
        <Link to="/analytics/projects">
          <Card className="transition hover:border-primary hover:shadow-md">
            <CardContent className="p-5">
              <h3 className="text-base font-semibold">项目交付盘</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                项目状态/工时四维/工单 SLA/延期明细
              </p>
            </CardContent>
          </Card>
        </Link>
        <Link to="/analytics/organization">
          <Card className="transition hover:border-primary hover:shadow-md">
            <CardContent className="p-5">
              <h3 className="text-base font-semibold">组织效率盘</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                填报完成 / 销售行为 / 审批 SLA / 部门规模
              </p>
            </CardContent>
          </Card>
        </Link>
      </div>
    </div>
  );
}
