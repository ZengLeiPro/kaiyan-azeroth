import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

export interface StatusConfig {
  label: string;
  variant?: 'default' | 'secondary' | 'destructive' | 'outline';
  className?: string;
  color?: string;
}

export interface StatusBadgeProps {
  status: string;
  statusMap: Record<string, StatusConfig | { label: string; color: string }>;
  fallback?: string;
  className?: string;
}

export function StatusBadge({ status, statusMap, fallback = '未知', className }: StatusBadgeProps) {
  const config = statusMap[status];

  if (!config) {
    return (
      <Badge variant="outline" className={className}>
        {fallback}
      </Badge>
    );
  }

  const badgeClassName =
    'className' in config ? config.className : 'color' in config ? config.color : undefined;
  // 仅指定 color/className 时用无底色的 soft variant，让配色 token 干净生效
  const variant = 'variant' in config && config.variant ? config.variant : 'soft';

  return (
    <Badge variant={variant} className={cn(badgeClassName, className)}>
      {config.label}
    </Badge>
  );
}
