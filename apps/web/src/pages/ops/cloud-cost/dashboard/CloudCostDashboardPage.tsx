import { CLOUD_ALERT_CATEGORY_LABELS } from '@ky-azeroth/shared/constants/status-labels';
import { format } from 'date-fns';
import {
  AlertTriangle,
  Calendar,
  DollarSign,
  Loader2,
  Package as PackageIcon,
  Receipt,
  Wallet,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { MetricCard as KpiCard } from '@/components/patterns/metric-card';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { api, getErrorMessage } from '@/lib/api';
import { logger } from '@/lib/logger';

import { type CloudCostOverviewProfile, toCloudCostOverviewProfile } from './types';

const fmtAmount = (n: number | null | undefined): string => {
  if (n == null) return '-';
  const v = Number(n);
  if (Number.isNaN(v)) return '-';
  return v.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

const PIE_COLORS = ['#22c55e', '#f59e0b', '#ef4444'];

export function CloudCostDashboardPage() {
  const [overview, setOverview] = useState<CloudCostOverviewProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const fetchOverview = useCallback(async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const res = await api.get('/cloud-bill-snapshots/overview', {
        params: { vendor: 'aliyun' },
      });
      setOverview(toCloudCostOverviewProfile(res.data));
    } catch (error) {
      logger.warn('CloudCostDashboardPage', 'fetch overview failed', error);
      setErrorMsg(getErrorMessage(error, '加载概览数据失败'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchOverview();
  }, [fetchOverview]);

  const healthScore = overview?.resourcePackageHealthScore ?? 0;
  const healthPieData = useMemo(() => {
    const score = Math.max(0, Math.min(100, healthScore));
    return [
      { name: '健康', value: score },
      { name: '已消耗', value: 100 - score },
    ];
  }, [healthScore]);

  const monthlyTrendData = useMemo(() => {
    if (!overview) return [];
    return overview.monthlyTrend.map((m) => ({
      billingCycle: m.billingCycle,
      paidAmount: Number(m.paidAmount) || 0,
      grossAmount: Number(m.grossAmount) || 0,
    }));
  }, [overview]);

  const topProductsData = useMemo(() => {
    if (!overview) return [];
    return overview.topProducts.slice(0, 5).map((p) => ({
      productName: p.productName || p.productCode,
      paidAmount: Number(p.paidAmount) || 0,
    }));
  }, [overview]);

  return (
    <div className="h-full space-y-6 overflow-auto p-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">云成本概览</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {overview ? `最新快照日期：${overview.latestSnapshotDate}` : '加载中...'}
        </p>
        {errorMsg && <p className="mt-2 text-sm text-destructive">{errorMsg}</p>}
      </div>

      {/* KPI 卡 */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label="账户余额"
          value={fmtAmount(overview?.balanceAvailable)}
          icon={Wallet}
          iconColor="text-emerald-600"
          iconBg="bg-emerald-100"
          loading={loading}
        />
        <KpiCard
          label="当月扣费"
          value={fmtAmount(overview?.mtdAmount)}
          icon={DollarSign}
          iconColor="text-blue-600"
          iconBg="bg-blue-100"
          loading={loading}
        />
        <KpiCard
          label="当月消耗（原价）"
          value={fmtAmount(overview?.mtdGrossAmount)}
          icon={Receipt}
          iconColor="text-violet-600"
          iconBg="bg-violet-100"
          loading={loading}
        />
        <KpiCard
          label="活跃预警"
          value={overview ? overview.activeAlertCount.toString() : '-'}
          icon={AlertTriangle}
          iconColor="text-amber-600"
          iconBg="bg-amber-100"
          loading={loading}
        />
      </div>

      {/* 双线图 + 资源包健康度 */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="border lg:col-span-2">
          <CardContent className="p-5">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-base font-semibold">近 6 个月扣费 / 消耗趋势</h3>
            </div>
            {loading ? (
              <div className="flex h-64 items-center justify-center">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : monthlyTrendData.length === 0 ? (
              <div className="flex h-64 items-center justify-center text-sm text-muted-foreground">
                暂无月度数据
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={280}>
                <LineChart
                  data={monthlyTrendData}
                  margin={{ top: 8, right: 16, bottom: 4, left: 0 }}
                >
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis dataKey="billingCycle" fontSize={12} />
                  <YAxis fontSize={12} />
                  <Tooltip
                    formatter={(value: number) => fmtAmount(value)}
                    labelFormatter={(label) => `账期 ${label}`}
                  />
                  <Legend />
                  <Line
                    type="monotone"
                    dataKey="paidAmount"
                    stroke="#2e56e1"
                    name="扣费"
                    dot={false}
                    strokeWidth={2}
                  />
                  <Line
                    type="monotone"
                    dataKey="grossAmount"
                    stroke="#7c3aed"
                    name="原价消耗"
                    dot={false}
                    strokeWidth={2}
                  />
                </LineChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card className="border">
          <CardContent className="p-5">
            <div className="mb-3 flex items-center gap-2">
              <PackageIcon className="h-5 w-5 text-cyan-600" />
              <h3 className="text-base font-semibold">资源包健康度</h3>
            </div>
            {loading ? (
              <div className="flex h-56 items-center justify-center">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <div className="flex flex-col items-center">
                <ResponsiveContainer width="100%" height={200}>
                  <PieChart>
                    <Pie
                      data={healthPieData}
                      dataKey="value"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      innerRadius={50}
                      outerRadius={75}
                      paddingAngle={2}
                    >
                      {healthPieData.map((entry, idx) => (
                        <Cell key={entry.name} fill={idx === 0 ? '#22c55e' : '#e5e7eb'} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(value: number) => `${value.toFixed(0)} 分`} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="mt-2 text-3xl font-bold tabular-nums">
                  {healthScore.toFixed(0)}
                  <span className="ml-1 text-sm font-normal text-muted-foreground">/ 100</span>
                </div>
                <p className="text-xs text-muted-foreground">按资源包余量加权</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Top 5 产品柱图 + 30 天内到期 */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="border">
          <CardContent className="p-5">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-base font-semibold">当月 Top 5 产品扣费</h3>
            </div>
            {loading ? (
              <div className="flex h-64 items-center justify-center">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : topProductsData.length === 0 ? (
              <div className="flex h-64 items-center justify-center text-sm text-muted-foreground">
                暂无产品扣费数据
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={topProductsData} margin={{ top: 8, right: 16, bottom: 4, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis dataKey="productName" fontSize={12} />
                  <YAxis fontSize={12} />
                  <Tooltip formatter={(value: number) => fmtAmount(value)} />
                  <Bar dataKey="paidAmount" name="扣费" fill="#0ea5e9" />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card className="border">
          <CardContent className="p-5">
            <div className="mb-3 flex items-center gap-2">
              <Calendar className="h-5 w-5 text-rose-600" />
              <h3 className="text-base font-semibold">30 天内到期资源</h3>
            </div>
            {loading ? (
              <div className="flex h-64 items-center justify-center">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : !overview?.upcomingExpirations.length ? (
              <div className="flex h-64 items-center justify-center text-sm text-muted-foreground">
                暂无即将到期资源
              </div>
            ) : (
              <div className="space-y-2">
                {overview.upcomingExpirations.slice(0, 8).map((item) => {
                  const danger = item.daysLeft <= 7;
                  const warn = !danger && item.daysLeft <= 30;
                  const badgeClass = danger
                    ? 'bg-red-100 text-red-800'
                    : warn
                      ? 'bg-amber-100 text-amber-800'
                      : 'bg-gray-100 text-gray-800';
                  return (
                    <div
                      key={`${item.kind}-${item.instanceId}`}
                      className="flex items-center justify-between rounded-md border px-3 py-2 text-sm"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <Badge variant="outline" className="text-[10px]">
                            {item.kind === 'package' ? '资源包' : '订阅'}
                          </Badge>
                          <span className="truncate font-medium" title={item.label}>
                            {item.label}
                          </span>
                        </div>
                        <p className="mt-0.5 truncate text-xs text-muted-foreground">
                          {item.productCode} · {item.instanceId}
                        </p>
                      </div>
                      <div className="flex shrink-0 flex-col items-end">
                        <Badge className={badgeClass}>剩余 {item.daysLeft} 天</Badge>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {format(new Date(item.expiryTime), 'yyyy-MM-dd')}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* 提示：常见预警类别（占位作图例） */}
      <Card className="border">
        <CardContent className="p-5">
          <h3 className="mb-3 text-base font-semibold">常见预警类别</h3>
          <div className="flex flex-wrap gap-2">
            {Object.entries(CLOUD_ALERT_CATEGORY_LABELS).map(([key, label]) => (
              <Badge key={key} variant="outline" className="text-xs">
                {label}
              </Badge>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* 防止未使用警告（PIE_COLORS 备用色板，便于后续 PieChart 扩展） */}
      <span className="hidden" data-pie-colors={PIE_COLORS.join(',')} />
    </div>
  );
}
