import {
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

interface RankingItem {
  id: string;
  name: string;
  value: number;
  hint?: string;
}

interface Props {
  data: RankingItem[];
  isAmount?: boolean;
  limit?: number;
  height?: number;
  /** 左侧 Y 轴宽度。默认 80，名称较长（如 SEO 关键词/落地页 URL）时建议传 200-240 */
  yAxisWidth?: number;
}

const fmtAmount = (n: number): string =>
  n.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * 通用排行榜横向柱图（销售/客户/产品 通用）
 */
export function RankingBarChart({
  data,
  isAmount = false,
  limit = 10,
  height = 280,
  yAxisWidth = 80,
}: Props) {
  const display = data.slice(0, limit);

  return (
    <ResponsiveContainer width="100%" height={Math.max(height, display.length * 32 + 40)}>
      <BarChart
        data={display}
        layout="vertical"
        margin={{ top: 8, right: 32, bottom: 4, left: 60 }}
      >
        <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
        <XAxis type="number" fontSize={12} />
        <YAxis type="category" dataKey="name" fontSize={12} width={yAxisWidth} />
        <Tooltip
          formatter={(value: number) =>
            isAmount ? [`￥${fmtAmount(value)}`, '金额'] : [value, '数量']
          }
          labelFormatter={(label: string, payload) => {
            const hint = (payload?.[0]?.payload as { hint?: string } | undefined)?.hint;
            return hint ? `${label} · ${hint}` : label;
          }}
        />
        <Bar dataKey="value" fill="#0ea5e9">
          <LabelList
            dataKey="value"
            position="right"
            formatter={(value: number) => (isAmount ? fmtAmount(value) : String(value))}
          />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
