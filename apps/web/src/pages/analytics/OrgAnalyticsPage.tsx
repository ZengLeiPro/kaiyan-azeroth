import type { IOrgDepartmentNode } from '@ky-azeroth/shared/types';
import { format } from 'date-fns';
import {
  Activity,
  AlertTriangle,
  Building2,
  Clock,
  TrendingUp,
  UserMinus,
  UserPlus,
  Users,
} from 'lucide-react';
import { useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
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
  useOrgApprovalSla,
  useOrgCompletion,
  useOrgDepartmentOverview,
  useOrgHeadcountTrend,
  useOrgKpis,
  useOrgSalesActivity,
} from './hooks/use-org-analytics-data';

function renderDeptNodes(nodes: IOrgDepartmentNode[], depth = 0): React.ReactNode {
  return nodes.flatMap((n) => [
    <div
      key={n.id}
      className="flex items-center gap-3 border-b px-3 py-2 text-sm last:border-b-0"
      style={{ paddingLeft: 12 + depth * 18 }}
    >
      <Building2 className="h-4 w-4 shrink-0 text-muted-foreground" />
      <span className="flex-1 truncate font-medium">{n.name}</span>
      <span className="text-xs text-muted-foreground">
        直接 {n.directEmployeeCount} · 含子孙 {n.recursiveEmployeeCount}
      </span>
      {n.managerName ? (
        <Badge variant="outline" className="text-xs">
          {n.managerName}
        </Badge>
      ) : (
        <Badge variant="destructive" className="text-xs">
          无负责人
        </Badge>
      )}
    </div>,
    ...(n.children.length > 0 ? [renderDeptNodes(n.children, depth + 1)] : []),
  ]);
}

export default function OrgAnalyticsPage() {
  const [range, setRange] = useState<AnalyticsRangeValue>({ preset: 'mtd' });

  const kpis = useOrgKpis(range);
  const completion = useOrgCompletion(range);
  const salesActivity = useOrgSalesActivity(range);
  const approvalSla = useOrgApprovalSla(range);
  const headcountTrend = useOrgHeadcountTrend(12);
  const deptOverview = useOrgDepartmentOverview();

  const syncHint = kpis.data?.syncStaleHint;

  return (
    <div className="h-full space-y-6 overflow-auto p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">组织效率盘</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {kpis.data
              ? `数据范围：${kpis.data.range.startDate} ~ ${kpis.data.range.endDate}`
              : kpis.isError
                ? '数据范围加载失败'
                : '加载中...'}
          </p>
          {syncHint && (
            <p className="mt-1 text-xs text-amber-600">
              钉钉日报最近同步：
              {syncHint.dingtalkLogsUpdatedAt
                ? format(new Date(syncHint.dingtalkLogsUpdatedAt), 'yyyy-MM-dd HH:mm')
                : '从未同步'}
              {' · '}
              离职数据最近同步：
              {syncHint.employeeLeavesUpdatedAt
                ? format(new Date(syncHint.employeeLeavesUpdatedAt), 'yyyy-MM-dd HH:mm')
                : '从未同步'}
            </p>
          )}
        </div>
        <AnalyticsDateRangePicker value={range} onChange={setRange} />
      </div>

      <AnalyticsQueryStatus
        queries={[
          toAnalyticsQueryState('核心指标', kpis),
          toAnalyticsQueryState('填报完成率', completion),
          toAnalyticsQueryState('销售活动', salesActivity),
          toAnalyticsQueryState('审批时效', approvalSla),
          toAnalyticsQueryState('人员趋势', headcountTrend),
          toAnalyticsQueryState('部门概览', deptOverview),
        ]}
      />

      {/* 5 KPI */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <KpiCard
          label="在职人数"
          value={kpis.data?.activeHeadcount ?? '-'}
          icon={Users}
          iconColor="text-blue-600"
          iconBg="bg-blue-100"
          loading={kpis.isLoading}
          error={kpis.isError}
          stale={kpis.isError && kpis.data !== undefined}
        />
        <KpiCard
          label="期内入职"
          value={kpis.data?.newHiresInPeriod ?? '-'}
          icon={UserPlus}
          iconColor="text-emerald-600"
          iconBg="bg-emerald-100"
          loading={kpis.isLoading}
          error={kpis.isError}
          stale={kpis.isError && kpis.data !== undefined}
        />
        <KpiCard
          label="期内离职"
          value={kpis.data?.leaversInPeriod ?? '-'}
          icon={UserMinus}
          iconColor="text-rose-600"
          iconBg="bg-rose-100"
          loading={kpis.isLoading}
          error={kpis.isError}
          stale={kpis.isError && kpis.data !== undefined}
        />
        <KpiCard
          label="DAU (30d 去重)"
          value={kpis.data?.dau30d ?? '-'}
          icon={Activity}
          iconColor="text-violet-600"
          iconBg="bg-violet-100"
          loading={kpis.isLoading}
          error={kpis.isError}
          stale={kpis.isError && kpis.data !== undefined}
        />
        <KpiCard
          label="MAU (30d 去重)"
          value={kpis.data?.mau ?? '-'}
          icon={TrendingUp}
          iconColor="text-amber-600"
          iconBg="bg-amber-100"
          loading={kpis.isLoading}
          error={kpis.isError}
          stale={kpis.isError && kpis.data !== undefined}
        />
      </div>

      {/* 填报完成三联 */}
      <ChartCard
        title="填报完成率"
        loading={completion.isLoading}
        empty={!completion.data}
        height={200}
      >
        {completion.data && (
          <div className="grid gap-4 sm:grid-cols-3">
            {(
              [
                { key: 'effort', label: '工时填报', v: completion.data.effort },
                { key: 'crmDaily', label: 'CRM 日报', v: completion.data.crmDaily },
                {
                  key: 'dingtalkDaily',
                  label: '钉钉日报',
                  v: completion.data.dingtalkDaily,
                },
              ] as const
            ).map((c) => (
              <div key={c.key} className="rounded-md border p-4">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">{c.label}</span>
                  <span className="text-lg font-bold tabular-nums">{c.v.rate}%</span>
                </div>
                <Progress value={c.v.rate} className="mt-2 h-2" />
                <p className="mt-1 text-xs text-muted-foreground">
                  应填 {c.v.expectedSlots} · 实填 {c.v.filledSlots}
                </p>
              </div>
            ))}
          </div>
        )}
      </ChartCard>

      {/* 销售行为 */}
      <div className="grid gap-4 lg:grid-cols-3">
        <ChartCard
          title="销售跟进密度 Top15"
          loading={salesActivity.isLoading}
          empty={!salesActivity.data || salesActivity.data.keepRecordDensity.length === 0}
          height={400}
        >
          {salesActivity.data && (
            <RankingBarChart data={salesActivity.data.keepRecordDensity} limit={15} />
          )}
        </ChartCard>

        <ChartCard
          title="拜访签到趋势"
          loading={salesActivity.isLoading}
          empty={!salesActivity.data || salesActivity.data.visitTrend.length === 0}
          height={300}
        >
          {salesActivity.data && (
            <ResponsiveContainer width="100%" height={280}>
              <LineChart
                data={salesActivity.data.visitTrend}
                margin={{ top: 8, right: 16, bottom: 4, left: 0 }}
              >
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis dataKey="bucket" fontSize={12} />
                <YAxis fontSize={12} />
                <Tooltip />
                <Line
                  type="monotone"
                  dataKey="value"
                  stroke="#2e56e1"
                  name="签到次数"
                  dot={false}
                  strokeWidth={2}
                />
              </LineChart>
            </ResponsiveContainer>
          )}
        </ChartCard>

        <ChartCard
          title="跟进类型分布"
          loading={salesActivity.isLoading}
          empty={!salesActivity.data || salesActivity.data.keepRecordTypeDistribution.length === 0}
          height={300}
        >
          {salesActivity.data && (
            <DistributionPie
              data={salesActivity.data.keepRecordTypeDistribution}
              topN={4}
              height={280}
            />
          )}
        </ChartCard>
      </div>

      {/* 审批 SLA */}
      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard
          title="审批端到端平均耗时（按流程类型）"
          loading={approvalSla.isLoading}
          empty={!approvalSla.data || approvalSla.data.endToEndByEventType.length === 0}
          height={320}
        >
          {approvalSla.data && (
            <ResponsiveContainer width="100%" height={300}>
              <BarChart
                data={approvalSla.data.endToEndByEventType}
                margin={{ top: 8, right: 16, bottom: 4, left: 0 }}
              >
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis dataKey="label" fontSize={12} />
                <YAxis fontSize={12} />
                <Tooltip formatter={(value: number) => [`${value} 小时`, '平均耗时']} />
                <Bar dataKey="avgHours" fill="#7c3aed" name="平均耗时" />
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartCard>

        <ChartCard
          title="审批节点平均停留时长"
          loading={approvalSla.isLoading}
          empty={!approvalSla.data || approvalSla.data.nodeStay.length === 0}
          height={320}
        >
          {approvalSla.data && (
            <RankingBarChart
              data={approvalSla.data.nodeStay.slice(0, 10).map((n) => ({
                id: n.nodeName,
                name: n.nodeName,
                value: n.avgHours,
                hint: `${n.sampleCount} 样本`,
              }))}
              limit={10}
            />
          )}
        </ChartCard>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <KpiCard
          label="审批通过率"
          value={approvalSla.data ? `${approvalSla.data.approveRate}%` : '-'}
          hint="approved / (approved + rejected + withdrawn)"
          icon={TrendingUp}
          iconColor="text-emerald-600"
          iconBg="bg-emerald-100"
          loading={approvalSla.isLoading}
          error={approvalSla.isError}
        />
        <ChartCard
          title="当前审批堆积 Top10"
          loading={approvalSla.isLoading}
          empty={!approvalSla.data || approvalSla.data.pendingTopApprovers.length === 0}
          emptyText="暂无堆积"
          height={320}
        >
          {approvalSla.data && (
            <RankingBarChart data={approvalSla.data.pendingTopApprovers} limit={10} />
          )}
        </ChartCard>
        <KpiCard
          label="堆积总数"
          value={
            approvalSla.data
              ? approvalSla.data.pendingTopApprovers.reduce((a, r) => a + r.value, 0)
              : '-'
          }
          icon={Clock}
          iconColor="text-amber-600"
          iconBg="bg-amber-100"
          loading={approvalSla.isLoading}
          error={approvalSla.isError}
        />
      </div>

      {/* 在职/入职/离职 月度趋势 */}
      <ChartCard
        title="人员月度趋势（近 12 月）"
        loading={headcountTrend.isLoading}
        empty={!headcountTrend.data || headcountTrend.data.months.length === 0}
        height={340}
      >
        {headcountTrend.data && (
          <ResponsiveContainer width="100%" height={300}>
            <BarChart
              data={headcountTrend.data.months}
              margin={{ top: 8, right: 16, bottom: 4, left: 0 }}
            >
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
              <XAxis dataKey="month" fontSize={12} />
              <YAxis fontSize={12} />
              <Tooltip />
              <Legend />
              <Bar dataKey="activeAtMonthEnd" fill="#2e56e1" name="期末在职" />
              <Bar dataKey="newHires" fill="#22c55e" name="入职" />
              <Bar dataKey="leavers" fill="#ef4444" name="离职" />
            </BarChart>
          </ResponsiveContainer>
        )}
      </ChartCard>

      {/* 部门规模 */}
      <ChartCard
        title={`部门规模（${
          deptOverview.data?.missingManagerDepartments.length ?? 0
        } 个部门缺管理员）`}
        action={
          deptOverview.data &&
          deptOverview.data.missingManagerDepartments.length > 0 && (
            <Badge variant="destructive" className="text-xs">
              <AlertTriangle className="mr-1 inline h-3 w-3" />
              缺管理员
            </Badge>
          )
        }
        loading={deptOverview.isLoading}
        empty={!deptOverview.data || deptOverview.data.tree.length === 0}
        height={400}
      >
        {deptOverview.data && (
          <div className="max-h-96 overflow-auto rounded-md border">
            {renderDeptNodes(deptOverview.data.tree)}
          </div>
        )}
      </ChartCard>

      {/* 缺管理员部门列表（如果有） */}
      {deptOverview.data && deptOverview.data.missingManagerDepartments.length > 0 && (
        <ChartCard title="缺管理员的部门" height={200} emptyText="（无）" empty={false}>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>部门名称</TableHead>
                <TableHead>建议操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {deptOverview.data.missingManagerDepartments.map((d) => (
                <TableRow key={d.id}>
                  <TableCell className="font-medium">{d.name}</TableCell>
                  <TableCell className="text-muted-foreground">
                    到组织架构 → 部门管理 设置负责人
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </ChartCard>
      )}
    </div>
  );
}
