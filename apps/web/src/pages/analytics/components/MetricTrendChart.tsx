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

interface TrendLine {
  key: string;
  name: string;
  color: string;
}

interface Props {
  data: ReadonlyArray<Record<string, string | number>>;
  xKey: string;
  lines: TrendLine[];
  /** 是否格式化为人民币金额 */
  isAmount?: boolean;
  height?: number;
}

const fmtAmount = (n: number): string =>
  n.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * 通用 Recharts LineChart 包装：多线 + 金额/数量格式化
 */
export function MetricTrendChart({ data, xKey, lines, isAmount = false, height = 280 }: Props) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart
        data={data as Array<Record<string, string | number>>}
        margin={{ top: 8, right: 16, bottom: 4, left: 0 }}
      >
        <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
        <XAxis dataKey={xKey} fontSize={12} />
        <YAxis fontSize={12} />
        <Tooltip formatter={(value: number) => (isAmount ? fmtAmount(value) : value.toString())} />
        <Legend />
        {lines.map((l) => (
          <Line
            key={l.key}
            type="monotone"
            dataKey={l.key}
            stroke={l.color}
            name={l.name}
            dot={false}
            strokeWidth={2}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}
