import type { IWebAnalyticsEngineLandingMatrixResponse } from '@ky-azeroth/shared/types';
import { useMemo } from 'react';

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

/**
 * 搜索引擎 × 落地页 热力矩阵：行=入口页（title 主显，path 副标题），
 * 列=各搜索引擎（按全局会话量降序），单元格颜色深浅=该入口页该引擎会话数。
 *
 * 颜色映射：每行独立归一化（避免大流量入口页让小流量页全部「冷色」），
 * 单元格背景透明度 = cell / rowMax。空 cell 显示 -。
 * 末列固定显示「行总计」便于横向对比入口页量级。
 */
export function EngineLandingHeatmap({ data }: { data: IWebAnalyticsEngineLandingMatrixResponse }) {
  const { engines, rows } = data;

  const fmt = useMemo(() => new Intl.NumberFormat('zh-CN'), []);

  if (engines.length === 0 || rows.length === 0) {
    return (
      <div className="rounded-md border p-6 text-center text-sm text-muted-foreground">
        当前区间无入口页数据
      </div>
    );
  }

  return (
    <div className="max-h-[460px] overflow-auto rounded-md border">
      <Table>
        <TableHeader className="sticky top-0 z-10 bg-card">
          <TableRow>
            <TableHead className="min-w-[260px]">入口页</TableHead>
            {engines.map((engine) => (
              <TableHead
                key={engine}
                className="whitespace-nowrap text-center"
                title={`列：${engine} 会话数`}
              >
                {engine}
              </TableHead>
            ))}
            <TableHead className="text-right">总计</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => {
            const rowMax = Math.max(1, ...engines.map((engine) => row.cells[engine] ?? 0));
            return (
              <TableRow key={row.landingPath}>
                <TableCell>
                  <div
                    className="max-w-[320px] truncate font-medium"
                    title={row.title ?? row.landingPath}
                  >
                    {row.title ?? row.landingPath}
                  </div>
                  <div
                    className="max-w-[320px] truncate text-xs text-muted-foreground"
                    title={row.landingPath}
                  >
                    {row.landingPath}
                  </div>
                </TableCell>
                {engines.map((engine) => {
                  const value = row.cells[engine] ?? 0;
                  const intensity = value > 0 ? value / rowMax : 0;
                  // sky-500 透明度档（避免内联 style 用 rgba，统一 Tailwind 调色板）
                  // 0 → 透明；其它分四档 100/300/500/700
                  let bg = '';
                  if (intensity > 0 && intensity <= 0.25) bg = 'bg-sky-100';
                  else if (intensity > 0.25 && intensity <= 0.5) bg = 'bg-sky-200';
                  else if (intensity > 0.5 && intensity <= 0.75) bg = 'bg-sky-300';
                  else if (intensity > 0.75) bg = 'bg-sky-400';
                  return (
                    <TableCell
                      key={engine}
                      className={`text-center tabular-nums ${bg}`}
                      title={`${row.title ?? row.landingPath} · ${engine}：${fmt.format(value)} 会话`}
                    >
                      {value > 0 ? (
                        fmt.format(value)
                      ) : (
                        <span className="text-muted-foreground">-</span>
                      )}
                    </TableCell>
                  );
                })}
                <TableCell className="text-right font-medium tabular-nums">
                  {fmt.format(row.totalSessions)}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
