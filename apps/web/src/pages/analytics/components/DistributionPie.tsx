import { ANALYTICS_CHART_COLORS } from '@ky-azeroth/shared/constants';
import { Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';

interface DistributionItem {
  key: string;
  label: string;
  count: number;
  percentage: number;
}

interface Props {
  data: DistributionItem[];
  /** Top N 之后聚合成「其他」（0 = 不聚合） */
  topN?: number;
  height?: number;
  /** 自定义色板（默认 ANALYTICS_CHART_COLORS） */
  colors?: readonly string[];
}

/**
 * 通用 PieChart 包装：自动按 Top N 折叠余项为「其他」
 */
export function DistributionPie({ data, topN = 0, height = 260, colors }: Props) {
  const palette = colors ?? ANALYTICS_CHART_COLORS;

  const chartData = (() => {
    if (topN === 0 || data.length <= topN) return data;
    const top = data.slice(0, topN);
    const rest = data.slice(topN);
    const restCount = rest.reduce((a, r) => a + r.count, 0);
    const restPercentage = rest.reduce((a, r) => a + r.percentage, 0);
    return [
      ...top,
      {
        key: '__rest__',
        label: `其他（${rest.length}）`,
        count: restCount,
        percentage: Math.round(restPercentage * 100) / 100,
      },
    ];
  })();

  return (
    <ResponsiveContainer width="100%" height={height}>
      <PieChart>
        <Pie
          data={chartData}
          dataKey="count"
          nameKey="label"
          cx="50%"
          cy="50%"
          outerRadius={Math.min(100, height / 2.6)}
          label={({ label, percent }: { label?: string; percent?: number }) =>
            `${label ?? ''} ${((percent ?? 0) * 100).toFixed(0)}%`
          }
        >
          {chartData.map((entry, idx) => (
            <Cell key={entry.key} fill={palette[idx % palette.length]} />
          ))}
        </Pie>
        <Tooltip
          formatter={(value: number, _name: string, props: { payload?: DistributionItem }) => [
            `${value} (${props.payload?.percentage ?? 0}%)`,
            props.payload?.label ?? '',
          ]}
        />
        <Legend />
      </PieChart>
    </ResponsiveContainer>
  );
}
