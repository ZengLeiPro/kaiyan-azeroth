import { Loader2, type LucideIcon } from 'lucide-react';

import { Card, CardContent } from '@/components/ui/card';

export interface MetricCardProps {
  label: string;
  value: string | number;
  hint?: string;
  icon: LucideIcon;
  iconColor: string;
  iconBg: string;
  loading?: boolean;
  error?: boolean;
  stale?: boolean;
}

/**
 * 通用指标卡：用于仪表盘 / 经营分析 / 成本看板等 KPI 区域。
 */
export function MetricCard({
  label,
  value,
  hint,
  icon: Icon,
  iconColor,
  iconBg,
  loading,
  error,
  stale,
}: MetricCardProps) {
  return (
    <Card className="border">
      <CardContent className="flex items-center gap-4 p-5">
        <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-lg ${iconBg}`}>
          <Icon className={`h-6 w-6 ${iconColor}`} />
        </div>
        <div className="min-w-0">
          <p className="text-sm text-muted-foreground">{label}</p>
          {loading ? (
            <Loader2 className="mt-1 h-5 w-5 animate-spin text-muted-foreground" />
          ) : error && !stale ? (
            <p className="text-sm font-medium text-destructive">加载失败</p>
          ) : (
            <p className="truncate text-2xl font-bold tabular-nums">{value}</p>
          )}
          {stale && !loading && (
            <p className="mt-0.5 text-xs text-amber-600">上次成功数据，当前非最新</p>
          )}
          {hint && !loading && (!error || stale) && (
            <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
