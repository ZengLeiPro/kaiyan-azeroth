import type {
  IXiaohongshuSummaryResponse,
  IXiaohongshuTrendResponse,
} from '@ky-azeroth/shared/types';
import { AlertTriangle, ArrowRight, CircleCheckBig, Info, ShieldAlert } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { Card, CardContent } from '@/components/ui/card';
import {
  SelectContent,
  SelectItem,
  SelectRoot as Select,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ChartCard } from '@/pages/analytics/components/ChartCard';

import {
  buildXiaohongshuOperatingSignals,
  buildXiaohongshuTrendSeries,
  type XiaohongshuSignalTone,
  type XiaohongshuTrendSeriesPoint,
} from './xiaohongshu-operating-insights';

const SIGNAL_STYLE: Record<
  XiaohongshuSignalTone,
  { border: string; icon: typeof AlertTriangle; iconClass: string }
> = {
  critical: { border: 'border-l-rose-500', icon: ShieldAlert, iconClass: 'text-rose-600' },
  warning: { border: 'border-l-amber-500', icon: AlertTriangle, iconClass: 'text-amber-600' },
  info: { border: 'border-l-blue-500', icon: Info, iconClass: 'text-blue-600' },
  positive: {
    border: 'border-l-emerald-500',
    icon: CircleCheckBig,
    iconClass: 'text-emerald-600',
  },
};

const EFFICIENCY_METRICS = [
  { value: 'ctr', label: '点击率', color: '#2563eb', format: 'percent' },
  { value: 'cpc', label: '平均点击成本', color: '#0f766e', format: 'amount' },
  { value: 'cpi', label: '互动成本', color: '#7c3aed', format: 'amount' },
  {
    value: 'messageConsultCost',
    label: '私信咨询成本',
    color: '#d97706',
    format: 'amount',
  },
] as const;

type EfficiencyMetric = (typeof EFFICIENCY_METRICS)[number]['value'];

const formatAmount = (value: number): string =>
  `¥${value.toLocaleString('zh-CN', { maximumFractionDigits: 2 })}`;

function formatChartValue(value: number, format: 'amount' | 'percent' | 'count'): string {
  if (format === 'amount') return formatAmount(value);
  if (format === 'percent') return `${(value * 100).toFixed(2)}%`;
  return value.toLocaleString('zh-CN');
}

function TrendChart({
  data,
  lines,
  format,
}: {
  data: XiaohongshuTrendSeriesPoint[];
  lines: Array<{ key: keyof XiaohongshuTrendSeriesPoint; label: string; color: string }>;
  format: 'amount' | 'percent' | 'count';
}) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <LineChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: 4 }}>
        <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
        <XAxis dataKey="date" fontSize={10} tickFormatter={(value: string) => value.slice(5)} />
        <YAxis
          fontSize={10}
          tickFormatter={(value: number) =>
            format === 'percent'
              ? `${(value * 100).toFixed(0)}%`
              : format === 'amount'
                ? `¥${value}`
                : value.toLocaleString('zh-CN')
          }
        />
        <Tooltip
          formatter={(value: number, name: string) => [formatChartValue(value, format), name]}
          labelFormatter={(label: string) => `日期：${label}`}
        />
        {lines.length > 1 && <Legend />}
        {lines.map((line) => (
          <Line
            key={line.key}
            type="monotone"
            dataKey={line.key}
            name={line.label}
            stroke={line.color}
            strokeWidth={2}
            dot={false}
            connectNulls={false}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}

export function XiaohongshuOperatingBrief({
  data,
  loading,
}: {
  data?: IXiaohongshuSummaryResponse;
  loading?: boolean;
}) {
  const location = useLocation();
  const signals = buildXiaohongshuOperatingSignals(data);
  if (loading || signals.length === 0) return null;

  return (
    <section>
      <div className="mb-3">
        <h2 className="text-lg font-semibold">本期经营判断</h2>
        <p className="text-xs text-muted-foreground">
          只依据当前可验证指标和上一等长周期生成；这是排查顺序，不是自动投放指令
        </p>
      </div>
      <div className="grid gap-3 lg:grid-cols-3">
        {signals.map((signal) => {
          const style = SIGNAL_STYLE[signal.tone];
          const Icon = style.icon;
          return (
            <Card key={signal.title} className={`border-l-4 ${style.border}`}>
              <CardContent className="space-y-3 p-4">
                <div className="flex items-start gap-2">
                  <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${style.iconClass}`} />
                  <div>
                    <h3 className="text-sm font-semibold">{signal.title}</h3>
                    <p className="mt-1 text-xs text-muted-foreground">{signal.evidence}</p>
                  </div>
                </div>
                <p className="text-sm leading-6">{signal.action}</p>
                <Link
                  to={{
                    pathname: `/analytics/xiaohongshu/${signal.target}`,
                    search: location.search,
                  }}
                  className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                >
                  查看相关数据 <ArrowRight className="h-3 w-3" />
                </Link>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </section>
  );
}

export function XiaohongshuTrendWorkbench({
  data,
  loading,
}: {
  data?: IXiaohongshuTrendResponse;
  loading?: boolean;
}) {
  const [efficiencyMetric, setEfficiencyMetric] = useState<EfficiencyMetric>('ctr');
  const series = useMemo(() => buildXiaohongshuTrendSeries(data), [data]);
  const efficiency = EFFICIENCY_METRICS.find((item) => item.value === efficiencyMetric)!;
  const hasGaps = series.some((point) => point.fee == null);

  return (
    <section>
      <div className="mb-3">
        <h2 className="text-lg font-semibold">趋势诊断</h2>
        <p className="text-xs text-muted-foreground">
          不同量纲分图展示；缺失日报保留断点，真实 0 仍画为 0
          {hasGaps ? ' · 当前区间存在日期断档' : ''}
        </p>
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <ChartCard
          title="每日消耗"
          description="按日消费金额"
          loading={loading}
          empty={series.length === 0}
          height={220}
        >
          <TrendChart
            data={series}
            lines={[{ key: 'fee', label: '消费', color: '#e11d48' }]}
            format="amount"
          />
        </ChartCard>
        <ChartCard
          title="流量与互动"
          description="点击和互动均为次数，不与金额共用坐标轴"
          loading={loading}
          empty={series.length === 0}
          height={220}
        >
          <TrendChart
            data={series}
            lines={[
              { key: 'click', label: '点击', color: '#2563eb' },
              { key: 'interaction', label: '互动', color: '#7c3aed' },
            ]}
            format="count"
          />
        </ChartCard>
        <ChartCard
          title="平台获客动作"
          description="私信咨询、私信留资、表单提交分开呈现，不等同于客户关系管理系统（CRM）线索"
          loading={loading}
          empty={series.length === 0}
          height={220}
        >
          <TrendChart
            data={series}
            lines={[
              { key: 'messageConsult', label: '私信咨询', color: '#d97706' },
              { key: 'messageLead', label: '私信留资', color: '#059669' },
              { key: 'formSubmit', label: '表单提交', color: '#0891b2' },
            ]}
            format="count"
          />
        </ChartCard>
        <ChartCard
          title="效率趋势"
          description="一次只比较一个效率指标，避免金额、比例与数量互相挤压"
          action={
            <Select
              value={efficiencyMetric}
              onValueChange={(value) => value && setEfficiencyMetric(value as EfficiencyMetric)}
            >
              <SelectTrigger className="w-[160px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {EFFICIENCY_METRICS.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          }
          loading={loading}
          empty={series.every((point) => point[efficiencyMetric] == null)}
          emptyText="所选效率指标暂无可用数据"
          height={220}
        >
          <TrendChart
            data={series}
            lines={[{ key: efficiency.value, label: efficiency.label, color: efficiency.color }]}
            format={efficiency.format}
          />
        </ChartCard>
      </div>
    </section>
  );
}
