import { AlertCircle, FileQuestion, FolderOpen, Inbox, Plus, Search } from 'lucide-react';
import { ReactNode } from 'react';

import { cn } from '@/lib/utils';

import { Button } from './button';

type EmptyStateVariant = 'default' | 'search' | 'error' | 'folder' | 'inbox';

interface EmptyStateProps {
  variant?: EmptyStateVariant;
  icon?: ReactNode;
  title?: string;
  description?: string;
  actionLabel?: string;
  onAction?: () => void;
  className?: string;
  children?: ReactNode;
}

const variantConfig: Record<
  EmptyStateVariant,
  { icon: ReactNode; title: string; description: string }
> = {
  default: {
    icon: <FileQuestion className="h-12 w-12 text-muted-foreground/50" />,
    title: '暂无数据',
    description: '当前列表没有任何数据',
  },
  search: {
    icon: <Search className="h-12 w-12 text-muted-foreground/50" />,
    title: '没有找到匹配结果',
    description: '尝试调整搜索条件或筛选器',
  },
  error: {
    icon: <AlertCircle className="h-12 w-12 text-destructive/50" />,
    title: '加载失败',
    description: '无法获取数据，请稍后重试',
  },
  folder: {
    icon: <FolderOpen className="h-12 w-12 text-muted-foreground/50" />,
    title: '文件夹为空',
    description: '此文件夹中没有任何内容',
  },
  inbox: {
    icon: <Inbox className="h-12 w-12 text-muted-foreground/50" />,
    title: '收件箱为空',
    description: '暂时没有新的消息',
  },
};

export function EmptyState({
  variant = 'default',
  icon,
  title,
  description,
  actionLabel,
  onAction,
  className,
  children,
}: EmptyStateProps) {
  const config = variantConfig[variant];

  return (
    <div
      className={cn('flex flex-col items-center justify-center px-4 py-12 text-center', className)}
      data-testid="empty-state"
    >
      <div className="mb-4" data-testid="empty-state-icon">
        {icon || config.icon}
      </div>
      <h3 className="mb-2 text-lg font-medium text-foreground" data-testid="empty-state-title">
        {title || config.title}
      </h3>
      <p
        className="mb-6 max-w-sm text-sm text-muted-foreground"
        data-testid="empty-state-description"
      >
        {description || config.description}
      </p>
      {actionLabel && onAction && (
        <Button onClick={onAction} data-testid="empty-state-action">
          <Plus className="mr-2 h-4 w-4" />
          {actionLabel}
        </Button>
      )}
      {children}
    </div>
  );
}
