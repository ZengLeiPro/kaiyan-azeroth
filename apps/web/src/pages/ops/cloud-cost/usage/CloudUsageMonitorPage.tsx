import { CLOUD_METRIC_NAME, CLOUD_PRODUCT_CODE } from '@ky-azeroth/shared/constants/cloud-cost';
import { format, subDays } from 'date-fns';
import { Loader2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { Card, CardContent } from '@/components/ui/card';
import { Select } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { api, getErrorMessage } from '@/lib/api';
import { logger } from '@/lib/logger';

import {
  type CloudUsageMetricProfile,
  type CloudUsageSeriesProfile,
  toCloudUsageMetricProfile,
  toCloudUsageSeriesProfile,
} from './types';

interface ProductTab {
  key: string;
  label: string;
  productCode: string;
  metricName: string;
  unitHint: string;
}

const PRODUCT_TABS: ProductTab[] = [
  {
    key: 'fc',
    label: '函数计算 FC',
    productCode: CLOUD_PRODUCT_CODE.FC,
    metricName: CLOUD_METRIC_NAME.FC_CU_USAGE,
    unitHint: 'CU',
  },
  {
    key: 'oss',
    label: '对象存储 OSS',
    productCode: CLOUD_PRODUCT_CODE.OSS,
    metricName: CLOUD_METRIC_NAME.OSS_STORAGE_SIZE,
    unitHint: 'bytes',
  },
  {
    key: 'cdt',
    label: '云数据传输 CDT',
    productCode: CLOUD_PRODUCT_CODE.CDT,
    metricName: CLOUD_METRIC_NAME.CDT_TRAFFIC_OUT,
    unitHint: 'bytes',
  },
  {
    key: 'ecs',
    label: 'ECS',
    productCode: CLOUD_PRODUCT_CODE.ECS,
    metricName: CLOUD_METRIC_NAME.ECS_TRAFFIC_OUT,
    unitHint: 'bytes',
  },
  {
    key: 'bailian',
    label: '百炼',
    productCode: CLOUD_PRODUCT_CODE.BAILIAN,
    metricName: CLOUD_METRIC_NAME.BAILIAN_CALL_COUNT,
    unitHint: 'count',
  },
  {
    key: 'sls',
    label: '日志服务 SLS',
    productCode: CLOUD_PRODUCT_CODE.SLS,
    metricName: CLOUD_METRIC_NAME.SLS_LOG_SIZE,
    unitHint: 'bytes',
  },
];

const RANGE_OPTIONS = [
  { value: '30', label: '近 30 天' },
  { value: '60', label: '近 60 天' },
  { value: '90', label: '近 90 天' },
];

const fmtValue = (v: number | string | null | undefined, decimals = 2): string => {
  if (v == null || v === '') return '-';
  const n = typeof v === 'number' ? v : Number(v);
  if (Number.isNaN(n)) return '-';
  return n.toLocaleString('zh-CN', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
};

interface TabPanelProps {
  tab: ProductTab;
  days: number;
}

interface MtdStats {
  current: number;
  previous: number;
  diffPct: number | null;
}

function TabPanel({ tab, days }: TabPanelProps) {
  const [series, setSeries] = useState<CloudUsageSeriesProfile | null>(null);
  const [seriesLoading, setSeriesLoading] = useState(true);
  const [topRows, setTopRows] = useState<CloudUsageMetricProfile[]>([]);
  const [topLoading, setTopLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const today = useMemo(() => new Date(), []);
  const startDate = useMemo(() => format(subDays(today, days), 'yyyy-MM-dd'), [today, days]);
  const endDate = useMemo(() => format(today, 'yyyy-MM-dd'), [today]);

  const fetchSeries = useCallback(async () => {
    setSeriesLoading(true);
    try {
      const res = await api.get('/cloud-usage-metrics/series', {
        params: {
          vendor: 'aliyun',
          productCode: tab.productCode,
          metricName: tab.metricName,
          startDate,
          endDate,
        },
      });
      setSeries(toCloudUsageSeriesProfile(res.data));
    } catch (error) {
      logger.warn('CloudUsageMonitorPage', 'fetch series failed', error);
      setSeries(null);
      setErrorMsg(getErrorMessage(error, '加载时序数据失败'));
    } finally {
      setSeriesLoading(false);
    }
  }, [tab.productCode, tab.metricName, startDate, endDate]);

  const fetchTop = useCallback(async () => {
    setTopLoading(true);
    try {
      const currentMonthStart = format(
        new Date(today.getFullYear(), today.getMonth(), 1),
        'yyyy-MM-dd'
      );
      const res = await api.get('/cloud-usage-metrics', {
        params: {
          vendor: 'aliyun',
          productCode: tab.productCode,
          metricName: tab.metricName,
          startDate: currentMonthStart,
          endDate,
          page: 1,
          pageSize: 100,
          sortField: 'value',
          sortOrder: 'desc',
        },
      });
      const items = (res.data?.items ?? []) as CloudUsageMetricProfile[];
      // 按 instanceId 聚合 value 求和
      const byInstance = new Map<
        string,
        { instanceId: string; total: number; unit: string | null }
      >();
      for (const item of items) {
        if (!item.instanceId) continue;
        const cur = byInstance.get(item.instanceId);
        const value = Number(item.value) || 0;
        if (cur) {
          cur.total += value;
        } else {
          byInstance.set(item.instanceId, {
            instanceId: item.instanceId,
            total: value,
            unit: item.unit ?? null,
          });
        }
      }
      const top = Array.from(byInstance.values())
        .sort((a, b) => b.total - a.total)
        .slice(0, 10);
      // 用 items 的 schema 作展示型最简包装：复用其中一行作为模板
      setTopRows(
        top.map((row, idx) => {
          const sample = items.find((i) => i.instanceId === row.instanceId) ?? items[0];
          if (!sample) {
            return {
              id: `agg-${idx}`,
              metricDate: endDate,
              vendor: 'aliyun',
              productCode: tab.productCode,
              metricName: tab.metricName,
              instanceId: row.instanceId,
              value: row.total,
              unit: row.unit,
            } as CloudUsageMetricProfile;
          }
          return toCloudUsageMetricProfile({
            ...sample,
            id: `agg-${row.instanceId}`,
            instanceId: row.instanceId,
            value: row.total,
            unit: row.unit ?? sample.unit,
          });
        })
      );
    } catch (error) {
      logger.warn('CloudUsageMonitorPage', 'fetch top rows failed', error);
      setTopRows([]);
    } finally {
      setTopLoading(false);
    }
  }, [tab.productCode, tab.metricName, today, endDate]);

  useEffect(() => {
    setErrorMsg(null);
    void fetchSeries();
    void fetchTop();
  }, [fetchSeries, fetchTop]);

  // 当月 / 上月同期 / 环比
  const mtdStats: MtdStats = useMemo(() => {
    if (!series) return { current: 0, previous: 0, diffPct: null };
    const now = new Date();
    const curMonth = now.getMonth();
    const curYear = now.getFullYear();
    let current = 0;
    let previous = 0;
    for (const p of series.points) {
      const d = new Date(p.date);
      const v = Number(p.value) || 0;
      if (d.getFullYear() === curYear && d.getMonth() === curMonth) {
        current += v;
      } else if (
        (curMonth === 0 && d.getFullYear() === curYear - 1 && d.getMonth() === 11) ||
        (d.getFullYear() === curYear && d.getMonth() === curMonth - 1)
      ) {
        previous += v;
      }
    }
    const diffPct = previous === 0 ? null : ((current - previous) / previous) * 100;
    return { current, previous, diffPct };
  }, [series]);

  const chartData = useMemo(() => {
    if (!series) return [];
    return series.points.map((p) => ({
      date: p.date,
      value: Number(p.value) || 0,
    }));
  }, [series]);

  return (
    <div className="space-y-4">
      {errorMsg && <p className="text-sm text-destructive">{errorMsg}</p>}

      {/* 顶部 3 张卡 */}
      <div className="grid gap-4 sm:grid-cols-3">
        <Card className="border">
          <CardContent className="p-5">
            <p className="text-sm text-muted-foreground">当月累计</p>
            {seriesLoading ? (
              <Loader2 className="mt-1 h-5 w-5 animate-spin text-muted-foreground" />
            ) : (
              <p className="mt-1 text-2xl font-bold tabular-nums">{fmtValue(mtdStats.current)}</p>
            )}
            <p className="mt-0.5 text-xs text-muted-foreground">{tab.unitHint}</p>
          </CardContent>
        </Card>
        <Card className="border">
          <CardContent className="p-5">
            <p className="text-sm text-muted-foreground">上月同期</p>
            {seriesLoading ? (
              <Loader2 className="mt-1 h-5 w-5 animate-spin text-muted-foreground" />
            ) : (
              <p className="mt-1 text-2xl font-bold tabular-nums">{fmtValue(mtdStats.previous)}</p>
            )}
            <p className="mt-0.5 text-xs text-muted-foreground">{tab.unitHint}</p>
          </CardContent>
        </Card>
        <Card className="border">
          <CardContent className="p-5">
            <p className="text-sm text-muted-foreground">环比</p>
            {seriesLoading ? (
              <Loader2 className="mt-1 h-5 w-5 animate-spin text-muted-foreground" />
            ) : mtdStats.diffPct == null ? (
              <p className="mt-1 text-lg text-muted-foreground">暂无</p>
            ) : (
              <p
                className={`mt-1 text-2xl font-bold tabular-nums ${
                  mtdStats.diffPct >= 0 ? 'text-red-600' : 'text-green-600'
                }`}
              >
                {mtdStats.diffPct >= 0 ? '+' : ''}
                {mtdStats.diffPct.toFixed(2)}%
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* 时序曲线 */}
      <Card className="border">
        <CardContent className="p-5">
          <h3 className="mb-3 text-base font-semibold">
            日级用量曲线（{tab.label} · {series?.metricName ?? tab.metricName}）
          </h3>
          {seriesLoading ? (
            <div className="flex h-64 items-center justify-center">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : chartData.length === 0 ? (
            <div className="flex h-64 items-center justify-center text-sm text-muted-foreground">
              暂无用量数据
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <LineChart data={chartData} margin={{ top: 8, right: 16, bottom: 4, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis dataKey="date" fontSize={12} />
                <YAxis fontSize={12} />
                <Tooltip formatter={(v: number) => fmtValue(v)} />
                <Line
                  type="monotone"
                  dataKey="value"
                  stroke="#2e56e1"
                  dot={false}
                  strokeWidth={2}
                  name={series?.unit || tab.unitHint}
                />
              </LineChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      {/* Top 10 表格 */}
      <Card className="border">
        <CardContent className="p-5">
          <h3 className="mb-3 text-base font-semibold">当月 Top 10 实例（按 value 聚合）</h3>
          {topLoading ? (
            <div className="flex h-32 items-center justify-center">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : topRows.length === 0 ? (
            <div className="flex h-32 items-center justify-center text-sm text-muted-foreground">
              暂无实例聚合数据
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs text-muted-foreground">
                    <th className="py-2 pr-4">#</th>
                    <th className="py-2 pr-4">实例 ID</th>
                    <th className="py-2 pr-4">累计 value</th>
                    <th className="py-2 pr-4">单位</th>
                  </tr>
                </thead>
                <tbody>
                  {topRows.map((row, idx) => (
                    <tr key={row.id} className="border-b last:border-b-0">
                      <td className="py-2 pr-4 text-muted-foreground">{idx + 1}</td>
                      <td className="py-2 pr-4 font-mono text-xs">{row.instanceId || '-'}</td>
                      <td className="py-2 pr-4 font-mono tabular-nums">{fmtValue(row.value, 2)}</td>
                      <td className="py-2 pr-4 text-muted-foreground">
                        {row.unit ?? tab.unitHint}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export function CloudUsageMonitorPage() {
  const [activeTab, setActiveTab] = useState<string>(PRODUCT_TABS[0]!.key);
  const [range, setRange] = useState<string>('30');
  const days = Number(range) || 30;

  return (
    <div className="h-full space-y-4 overflow-auto p-6">
      <div className="flex items-end justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">用量监控</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            按产品查看日级用量曲线与当月 Top 10 实例
          </p>
        </div>
        <div className="w-28">
          <Select
            options={RANGE_OPTIONS}
            value={range}
            onValueChange={(v) => setRange(v)}
            contentClassName="min-w-[144px] max-w-[calc(100vw-2rem)]"
          />
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="flex flex-wrap">
          {PRODUCT_TABS.map((tab) => (
            <TabsTrigger key={tab.key} value={tab.key}>
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>
        {PRODUCT_TABS.map((tab) => (
          <TabsContent key={tab.key} value={tab.key} className="mt-4">
            <TabPanel tab={tab} days={days} />
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}
