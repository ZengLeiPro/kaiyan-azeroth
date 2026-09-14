import { useMemo } from 'react';

import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

import type { CompletionCheckRow } from '../types';

interface CompletionCheckProps {
  data: CompletionCheckRow[];
  isLoading: boolean;
}

/**
 * 填报完整性视图：
 * - 同时展示已填 / 未填两种状态，方便周会回顾时一眼对比谁补上了、谁还欠
 * - 后端 statsCompletion 已只返回 PM/DEVELOPER 角色员工，前端无需再筛
 * - 默认按日期倒序 + 未填优先 + 姓名升序，让缺填记录上浮到列表顶部
 */
export function CompletionCheck({ data, isLoading }: CompletionCheckProps) {
  const sortedRows = useMemo(
    () =>
      [...data].sort((a, b) => {
        const dateCompare = b.date.localeCompare(a.date);
        if (dateCompare !== 0) return dateCompare;
        // 未填(filled=false)排在已填前面
        if (a.filled !== b.filled) return a.filled ? 1 : -1;
        return a.employeeName.localeCompare(b.employeeName);
      }),
    [data]
  );

  const unfilledCount = useMemo(() => sortedRows.filter((r) => !r.filled).length, [sortedRows]);

  if (isLoading) {
    return <div className="py-8 text-center text-sm text-muted-foreground">加载中...</div>;
  }

  if (sortedRows.length === 0) {
    return (
      <div className="py-8 text-center text-sm text-muted-foreground">
        所选日期范围内没有符合条件的填报记录
      </div>
    );
  }

  const filledCount = sortedRows.length - unfilledCount;

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        共 <span className="font-medium text-foreground">{sortedRows.length}</span> 条记录(
        <span className="font-medium text-destructive">{unfilledCount}</span> 未填 /
        <span className="font-medium text-foreground"> {filledCount}</span> 已填)
      </p>

      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>员工</TableHead>
              <TableHead>日期</TableHead>
              <TableHead>状态</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sortedRows.map((row, index) => (
              <TableRow key={`${row.employeeId}-${row.date}-${index}`}>
                <TableCell className="font-medium">{row.employeeName}</TableCell>
                <TableCell>
                  {new Date(row.date + 'T00:00:00').toLocaleDateString('zh-CN', {
                    month: '2-digit',
                    day: '2-digit',
                    weekday: 'short',
                  })}
                </TableCell>
                <TableCell>
                  {row.filled ? (
                    <Badge variant="secondary">已填</Badge>
                  ) : (
                    <Badge variant="destructive">未填</Badge>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
