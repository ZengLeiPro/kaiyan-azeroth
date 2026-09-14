import type { IWebAnalyticsContentItem } from '@ky-azeroth/shared/types';
import {
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from 'recharts';

interface Props {
  items: IWebAnalyticsContentItem[];
  height?: number;
}

interface Point {
  x: number; // PV（曝光）
  y: number; // 读完率（质量）
  z: number; // UV（点大小）
  title: string;
  path: string;
}

/** PV 中位数作为「高/低曝光」分界；读完率 50% 作为「高/低质量」分界 */
function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
  }
  return sorted[mid] ?? 0;
}

/**
 * 内容四象限散点：X=PV（曝光），Y=读完率（质量）。
 * 右上=明星 / 右下=高曝光低质量（改内容）/ 左上=高质量低曝光（抢排名）/ 左下=鸡肋。
 */
export function ContentQuadrantChart({ items, height = 340 }: Props) {
  const points: Point[] = items
    .filter((it) => it.uv > 0)
    .map((it) => ({
      x: it.pv,
      y: it.completionRate,
      z: it.uv,
      title: it.title ?? it.path,
      path: it.path,
    }));

  const pvMedian = median(points.map((p) => p.x));
  const qualityLine = 50;

  return (
    <ResponsiveContainer width="100%" height={height}>
      <ScatterChart margin={{ top: 16, right: 24, bottom: 16, left: 8 }}>
        <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
        <XAxis
          type="number"
          dataKey="x"
          name="PV"
          fontSize={12}
          label={{ value: 'PV（曝光）', position: 'insideBottomRight', offset: -4, fontSize: 11 }}
        />
        <YAxis
          type="number"
          dataKey="y"
          name="读完率"
          unit="%"
          domain={[0, 100]}
          fontSize={12}
          label={{ value: '读完率（质量）', angle: -90, position: 'insideLeft', fontSize: 11 }}
        />
        <ZAxis type="number" dataKey="z" range={[40, 400]} name="UV" />
        <ReferenceLine x={pvMedian} stroke="#94a3b8" strokeDasharray="4 4" />
        <ReferenceLine y={qualityLine} stroke="#94a3b8" strokeDasharray="4 4" />
        <Tooltip
          cursor={{ strokeDasharray: '3 3' }}
          content={({ active, payload }) => {
            if (!active || !payload?.length) return null;
            const p = payload[0]?.payload as Point | undefined;
            if (!p) return null;
            return (
              <div className="rounded-md border bg-popover px-3 py-2 text-xs shadow-md">
                <div className="max-w-[260px] truncate font-medium">{p.title}</div>
                <div className="mt-1 text-muted-foreground">
                  PV {p.x.toLocaleString('zh-CN')} · UV {p.z.toLocaleString('zh-CN')} · 读完率{' '}
                  {p.y.toFixed(1)}%
                </div>
              </div>
            );
          }}
        />
        <Scatter data={points} fill="#2563eb" fillOpacity={0.6} />
      </ScatterChart>
    </ResponsiveContainer>
  );
}
