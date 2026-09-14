import { ChevronDown } from 'lucide-react';
import { useMemo, useState } from 'react';
import {
  Cell,
  Legend,
  Pie,
  PieChart,
  type PieLabelRenderProps,
  ResponsiveContainer,
  Tooltip,
} from 'recharts';

import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useIsMobile } from '@/hooks/use-mobile';
import { cn } from '@/lib/utils';

import type { ProjectStatRow } from '../types';

const COLORS = [
  'hsl(210, 70%, 55%)',
  'hsl(150, 60%, 45%)',
  'hsl(35, 80%, 55%)',
  'hsl(340, 65%, 55%)',
  'hsl(260, 55%, 55%)',
  'hsl(180, 50%, 45%)',
  'hsl(15, 70%, 55%)',
  'hsl(290, 50%, 55%)',
];

interface ProjectStatsProps {
  data: ProjectStatRow[];
  isLoading: boolean;
}

function toSvgTextAnchor(anchor: string): 'start' | 'middle' | 'end' {
  if (anchor === 'start' || anchor === 'middle' || anchor === 'end') return anchor;
  return 'middle';
}

function renderProjectLabel({ name, percent, x, y, textAnchor }: PieLabelRenderProps) {
  return (
    <text
      x={x}
      y={y}
      textAnchor={toSvgTextAnchor(textAnchor)}
      dominantBaseline="central"
      fill="hsl(var(--muted-foreground))"
      fontSize={10}
    >
      {`${name}: ${((percent ?? 0) * 100).toFixed(0)}%`}
    </text>
  );
}

export function ProjectStats({ data, isLoading }: ProjectStatsProps) {
  const isMobile = useIsMobile();
  const [isChartExpanded, setIsChartExpanded] = useState(false);

  const chartData = useMemo(
    () =>
      data
        .slice()
        .sort((a, b) => b.totalHours - a.totalHours)
        .slice(0, 8)
        .map((row) => ({
          name: row.projectName,
          value: row.totalHours,
        })),
    [data]
  );

  const sortedRows = useMemo(
    () => data.slice().sort((a, b) => b.totalHours - a.totalHours),
    [data]
  );

  const totalHours = useMemo(() => data.reduce((sum, row) => sum + row.totalHours, 0), [data]);

  if (isLoading) {
    return <div className="py-8 text-center text-sm text-muted-foreground">加载中...</div>;
  }

  if (data.length === 0) {
    return <div className="py-8 text-center text-sm text-muted-foreground">暂无数据</div>;
  }

  return (
    <div className="space-y-6">
      {/* Pie chart */}
      <div className="rounded-lg border p-4">
        <button
          type="button"
          className="flex w-full items-center justify-between gap-3 text-left"
          aria-expanded={isChartExpanded}
          onClick={() => setIsChartExpanded((value) => !value)}
        >
          <h4 className="text-sm font-medium">各项目工时占比</h4>
          <ChevronDown
            className={cn(
              'h-4 w-4 shrink-0 text-muted-foreground transition-transform',
              isChartExpanded && 'rotate-180'
            )}
          />
        </button>

        {isChartExpanded && (
          <div className="mt-3">
            <ResponsiveContainer width="100%" height={300}>
              <PieChart>
                <Pie
                  data={chartData}
                  cx="50%"
                  cy="50%"
                  outerRadius={isMobile ? 80 : 100}
                  dataKey="value"
                  nameKey="name"
                  label={renderProjectLabel}
                  labelLine
                >
                  {chartData.map((_, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip formatter={(value: number) => [`${value.toFixed(1)}h`, '工时']} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      {/* Table */}
      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>客户</TableHead>
              <TableHead>项目名称</TableHead>
              <TableHead className="text-right">累计投入</TableHead>
              <TableHead className="text-right">占比</TableHead>
              <TableHead className="text-right">参与人数</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sortedRows.map((row) => (
              <TableRow key={row.projectId}>
                <TableCell>{row.customerName}</TableCell>
                <TableCell className="font-medium">{row.projectName}</TableCell>
                <TableCell className="text-right">{row.totalHours.toFixed(1)}h</TableCell>
                <TableCell className="text-right">
                  {totalHours > 0 ? `${((row.totalHours / totalHours) * 100).toFixed(1)}%` : '-'}
                </TableCell>
                <TableCell className="text-right">{row.participantCount}</TableCell>
              </TableRow>
            ))}
          </TableBody>
          <TableFooter>
            <TableRow className="font-bold">
              <TableCell />
              <TableCell>合计</TableCell>
              <TableCell className="text-right">{totalHours.toFixed(1)}h</TableCell>
              <TableCell />
              <TableCell />
            </TableRow>
          </TableFooter>
        </Table>
      </div>
    </div>
  );
}
