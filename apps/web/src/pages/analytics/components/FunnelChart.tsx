import { FUNNEL_OUTCOME_COLORS } from '@ky-azeroth/shared/constants';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

interface FunnelStage {
  stage: string;
  count: number;
  amount: number;
}

interface Props {
  stages: FunnelStage[];
  height?: number;
}

const fmtAmount = (n: number): string =>
  n.toLocaleString('zh-CN', { minimumFractionDigits: 0, maximumFractionDigits: 0 });

/**
 * 商机阶段漏斗：横向柱状图模拟漏斗效果
 *
 * 颜色规则：
 * - 进行中 4 阶段（发现需求 / 解决方案 / 商务谈判 / 合同签约）→ 蓝色
 * - 赢单 → 绿色
 * - 输单流失 → 灰色
 */
export function FunnelChart({ stages, height = 280 }: Props) {
  const data = stages.map((s) => ({
    stage: s.stage,
    count: s.count,
    amount: s.amount,
  }));

  const colorFor = (stage: string): string => {
    if (stage === '赢单') return FUNNEL_OUTCOME_COLORS.won;
    if (stage === '输单流失') return FUNNEL_OUTCOME_COLORS.lost;
    return FUNNEL_OUTCOME_COLORS.inFlight;
  };

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} layout="vertical" margin={{ top: 8, right: 32, bottom: 4, left: 64 }}>
        <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
        <XAxis type="number" fontSize={12} />
        <YAxis type="category" dataKey="stage" fontSize={12} width={80} />
        <Tooltip
          formatter={(value: number, name: string) =>
            name === 'amount' ? [`￥${fmtAmount(value)}`, '金额'] : [value, '数量']
          }
        />
        <Bar dataKey="amount" name="金额">
          {data.map((d) => (
            <Cell key={d.stage} fill={colorFor(d.stage)} />
          ))}
          <LabelList
            dataKey="count"
            position="right"
            formatter={(value: number) => `${value} 个`}
          />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
