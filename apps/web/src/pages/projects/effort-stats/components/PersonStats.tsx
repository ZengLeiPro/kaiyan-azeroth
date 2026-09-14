import { useMemo } from 'react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

import { Progress } from '@/components/ui/progress';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useIsMobile } from '@/hooks/use-mobile';
import { cn } from '@/lib/utils';

import type { PersonStatRow } from '../types';

interface PersonStatsProps {
  data: PersonStatRow[];
  isLoading: boolean;
}

export function PersonStats({ data, isLoading }: PersonStatsProps) {
  const isMobile = useIsMobile();

  const chartData = useMemo(
    () =>
      data
        .slice()
        .sort((a, b) => b.totalHours - a.totalHours)
        .slice(0, 20)
        .map((row) => ({
          name: row.employeeName,
          totalHours: row.totalHours,
        })),
    [data]
  );

  if (isLoading) {
    return <div className="py-8 text-center text-sm text-muted-foreground">加载中...</div>;
  }

  if (data.length === 0) {
    return <div className="py-8 text-center text-sm text-muted-foreground">暂无数据</div>;
  }

  return (
    <div className="space-y-6">
      {/* Chart */}
      <div className="rounded-lg border p-4">
        <h4 className="mb-3 text-sm font-medium">人员工时对比</h4>
        <ResponsiveContainer width="100%" height={Math.max(200, chartData.length * 36)}>
          <BarChart data={chartData} layout="vertical" margin={{ left: 60, right: 20 }}>
            <CartesianGrid strokeDasharray="3 3" horizontal={false} />
            <XAxis type="number" />
            <YAxis type="category" dataKey="name" width={56} tick={{ fontSize: 12 }} />
            <Tooltip formatter={(value: number) => [`${value.toFixed(1)}h`, '工时']} />
            <Bar
              dataKey="totalHours"
              name="工时"
              fill="hsl(var(--primary))"
              radius={[0, 4, 4, 0]}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Table */}
      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>员工姓名</TableHead>
              <TableHead className="text-right">工时</TableHead>
              <TableHead className={cn('text-right', isMobile && 'hidden')}>记录数</TableHead>
              <TableHead className={cn(isMobile ? 'w-20' : 'w-40')}>饱和度</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.map((row) => (
              <TableRow key={row.employeeId}>
                <TableCell className="font-medium">{row.employeeName}</TableCell>
                <TableCell className="text-right">{row.totalHours.toFixed(1)}h</TableCell>
                <TableCell className={cn('text-right', isMobile && 'hidden')}>
                  {row.recordCount}
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <Progress value={row.saturation} className="h-2 flex-1" />
                    <span className="w-10 text-right text-xs text-muted-foreground">
                      {row.saturation}%
                    </span>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
