import type { IWebAnalyticsContentItem } from '@ky-azeroth/shared/types';
import { ArrowDown, ArrowUp } from 'lucide-react';
import { useMemo, useState } from 'react';

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

type SortKey = 'pv' | 'uv' | 'avgScrollDepth' | 'completionRate' | 'deepReadRate';

const COLUMNS: Array<{ key: SortKey; label: string; hint?: string }> = [
  { key: 'pv', label: 'PV' },
  { key: 'uv', label: 'UV' },
  {
    key: 'avgScrollDepth',
    label: '平均滚动深度',
    hint: '优先 AVG raw.pct 精确值（06-13 起 beacon 透传），缺失时回退到 25/50/75/100 档位加权估算',
  },
  { key: 'completionRate', label: '读完率', hint: '读到100%/UV' },
  { key: 'deepReadRate', label: '深读率', hint: '停留≥180s/UV' },
];

const fmtPct = (n: number): string => `${n.toFixed(1)}%`;

/** 数值条：用背景宽度直观表达 0-100% 指标 */
function PctBar({ value, color }: { value: number; color: string }) {
  return (
    <div className="flex items-center justify-end gap-2">
      <div className="h-1.5 w-16 overflow-hidden rounded bg-muted">
        <div
          className="h-full rounded"
          style={{ width: `${Math.min(100, Math.max(0, value))}%`, backgroundColor: color }}
        />
      </div>
      <span className="w-12 text-right tabular-nums">{fmtPct(value)}</span>
    </div>
  );
}

/**
 * 博客内容质量榜：可排序表。每篇文章一行，列出 PV/UV/平均滚动深度/读完率/深读率。
 * 滚动/停留为里程碑事件估算（非连续精确值）。
 */
export function ContentEngagementTable({ items }: { items: IWebAnalyticsContentItem[] }) {
  const [sortKey, setSortKey] = useState<SortKey>('pv');
  const [sortDesc, setSortDesc] = useState(true);

  // avgScrollDepth 列实际显示「精确优先 + 档位回退」融合值。排序时也用融合值，否则
  // 表头切「按平均滚动深度」点击得到的顺序与肉眼可见列不一致，体验割裂。
  const effectiveScrollDepth = (item: IWebAnalyticsContentItem): number =>
    item.avgScrollPctExact ?? item.avgScrollDepth;

  const sorted = useMemo(() => {
    const copy = [...items];
    copy.sort((a, b) => {
      const diff =
        sortKey === 'avgScrollDepth'
          ? effectiveScrollDepth(a) - effectiveScrollDepth(b)
          : a[sortKey] - b[sortKey];
      return sortDesc ? -diff : diff;
    });
    return copy;
  }, [items, sortKey, sortDesc]);

  const toggleSort = (key: SortKey) => {
    if (key === sortKey) {
      setSortDesc((prev) => !prev);
    } else {
      setSortKey(key);
      setSortDesc(true);
    }
  };

  return (
    <div className="max-h-[460px] overflow-auto rounded-md border">
      <Table>
        <TableHeader className="sticky top-0 z-10 bg-card">
          <TableRow>
            <TableHead className="min-w-[260px]">文章</TableHead>
            {COLUMNS.map((col) => (
              <TableHead key={col.key} className="text-right">
                <button
                  type="button"
                  onClick={() => toggleSort(col.key)}
                  className="ml-auto inline-flex items-center gap-1 hover:text-foreground"
                  title={col.hint}
                >
                  {col.label}
                  {sortKey === col.key &&
                    (sortDesc ? (
                      <ArrowDown className="h-3 w-3" />
                    ) : (
                      <ArrowUp className="h-3 w-3" />
                    ))}
                </button>
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {sorted.map((item) => (
            <TableRow key={item.path}>
              <TableCell>
                <div className="max-w-[360px] truncate font-medium" title={item.title ?? item.path}>
                  {item.title ?? item.path}
                </div>
                <div
                  className="max-w-[360px] truncate text-xs text-muted-foreground"
                  title={item.path}
                >
                  {item.path}
                </div>
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {item.pv.toLocaleString('zh-CN')}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {item.uv.toLocaleString('zh-CN')}
              </TableCell>
              <TableCell>
                {item.avgScrollPctExact != null ? (
                  <div className="flex flex-col items-end gap-0.5">
                    <PctBar value={item.avgScrollPctExact} color="#0ea5e9" />
                    <span
                      className="text-[10px] text-emerald-600"
                      title={`AVG raw.pct，基于 ${item.exactPctEventCount} 条 article_read 事件`}
                    >
                      精确 · {item.exactPctEventCount}
                    </span>
                  </div>
                ) : (
                  <div className="flex flex-col items-end gap-0.5">
                    <PctBar value={item.avgScrollDepth} color="#0ea5e9" />
                    <span
                      className="text-[10px] text-muted-foreground"
                      title="无 raw.pct 数据，回退到 25/50/75/100 档位人数加权估算"
                    >
                      档位估算
                    </span>
                  </div>
                )}
              </TableCell>
              <TableCell>
                <PctBar value={item.completionRate} color="#16a34a" />
              </TableCell>
              <TableCell>
                <PctBar value={item.deepReadRate} color="#f59e0b" />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
