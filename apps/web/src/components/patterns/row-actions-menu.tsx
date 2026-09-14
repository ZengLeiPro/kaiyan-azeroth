import { MoreHorizontal } from 'lucide-react';
import { Fragment, MouseEvent, ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';

export interface RowAction<T> {
  /** 操作唯一标识 */
  key: string;
  /** 操作标签 */
  label: string;
  /** 操作图标 */
  icon?: ReactNode;
  /** 点击回调 */
  onClick: (item: T) => void;
  /** 是否隐藏此操作（基于行数据动态控制） */
  hidden?: (item: T) => boolean;
  /** 是否禁用 */
  disabled?: (item: T) => boolean;
  /** 危险操作样式（红色文字） */
  danger?: boolean;
  /** 在此操作前显示分隔线 */
  separator?: boolean;
}

export interface RowActionsMenuProps<T> {
  /** 当前行数据 */
  item: T;
  /** 操作列表 */
  actions: RowAction<T>[];
  /** 自定义类名 */
  className?: string;
}

/**
 * 行操作下拉菜单组件
 *
 * 用于 CrudTable 的操作列，提供查看/编辑/删除等操作的下拉菜单。
 * 自动阻止行点击事件冒泡。
 *
 * @example
 * ```tsx
 * <RowActionsMenu
 *   item={customer}
 *   actions={[
 *     { key: 'view', label: '查看', icon: <Eye />, onClick: crud.openViewDialog },
 *     { key: 'edit', label: '编辑', icon: <Pencil />, onClick: crud.openEditDialog },
 *     { key: 'delete', label: '删除', icon: <Trash2 />, onClick: crud.openDeleteDialog, danger: true, separator: true },
 *   ]}
 * />
 * ```
 */
export function RowActionsMenu<T>({ item, actions, className }: RowActionsMenuProps<T>) {
  const handleClick = (e: MouseEvent) => {
    e.stopPropagation();
  };

  const visibleActions = actions.filter((action) => !action.hidden?.(item));

  if (visibleActions.length === 0) {
    return null;
  }

  return (
    <div className={cn('flex items-center justify-center', className)} onClick={handleClick}>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="操作菜单">
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-36">
          {visibleActions.map((action) => (
            <Fragment key={action.key}>
              {action.separator && <DropdownMenuSeparator />}
              <DropdownMenuItem
                onSelect={() => {
                  // 延迟执行以避免 DropdownMenu 关闭动画与新对话框打开的竞争
                  setTimeout(() => action.onClick(item), 0);
                }}
                disabled={action.disabled?.(item)}
                className={cn(
                  'cursor-pointer',
                  action.danger && 'text-destructive focus:text-destructive'
                )}
              >
                {action.icon && <span className="mr-2 h-4 w-4">{action.icon}</span>}
                {action.label}
              </DropdownMenuItem>
            </Fragment>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
