import { Loader2 } from 'lucide-react';
import type { ReactNode } from 'react';

import { Card, CardContent } from '@/components/ui/card';

interface ChartCardProps {
  title: string;
  description?: string;
  action?: ReactNode;
  height?: number;
  loading?: boolean;
  empty?: boolean;
  emptyText?: string;
  children: ReactNode;
}

/**
 * 通用图表卡片：统一标题 + 操作区 + 加载/空态/正常态切换
 */
export function ChartCard({
  title,
  description,
  action,
  height = 280,
  loading,
  empty,
  emptyText = '暂无数据',
  children,
}: ChartCardProps) {
  return (
    <Card className="border">
      <CardContent className="p-5">
        <div className="mb-3 flex items-start justify-between gap-2">
          <div>
            <h3 className="text-base font-semibold">{title}</h3>
            {description && <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>}
          </div>
          {action}
        </div>
        {loading ? (
          <div className="flex items-center justify-center" style={{ height }}>
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : empty ? (
          <div
            className="flex items-center justify-center text-sm text-muted-foreground"
            style={{ height }}
          >
            {emptyText}
          </div>
        ) : (
          <div style={{ minHeight: height }}>{children}</div>
        )}
      </CardContent>
    </Card>
  );
}
