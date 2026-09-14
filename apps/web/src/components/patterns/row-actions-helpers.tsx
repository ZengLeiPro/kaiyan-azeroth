import { Eye, Pencil, Trash2 } from 'lucide-react';

import { RowAction } from './row-actions-menu';

/**
 * 创建标准的 CRUD 行操作列表
 *
 * 快捷方法：生成查看、编辑、删除三个标准操作。
 *
 * @param handlers 操作处理函数
 * @returns 标准 RowAction 列表
 */
export function createStandardActions<T>(handlers: {
  onView?: (item: T) => void;
  onEdit?: (item: T) => void;
  onDelete?: (item: T) => void;
  /** 动态控制编辑按钮的禁用（基于行数据） */
  canEdit?: (item: T) => boolean;
  /** 动态控制删除按钮的禁用（基于行数据） */
  canDelete?: (item: T) => boolean;
  /** 静态隐藏编辑按钮（基于权限） */
  hideEdit?: boolean;
  /** 静态隐藏删除按钮（基于权限） */
  hideDelete?: boolean;
  /** 业务扩展操作，插入在删除按钮之前 */
  extraActions?: RowAction<T>[];
}): RowAction<T>[] {
  const actions: RowAction<T>[] = [];

  if (handlers.onView) {
    actions.push({
      key: 'view',
      label: '查看',
      icon: <Eye className="h-4 w-4" />,
      onClick: handlers.onView,
    });
  }

  if (handlers.onEdit && !handlers.hideEdit) {
    actions.push({
      key: 'edit',
      label: '编辑',
      icon: <Pencil className="h-4 w-4" />,
      onClick: handlers.onEdit,
      disabled: handlers.canEdit ? (item) => !handlers.canEdit!(item) : undefined,
    });
  }

  if (handlers.extraActions?.length) {
    actions.push(...handlers.extraActions);
  }

  if (handlers.onDelete && !handlers.hideDelete) {
    actions.push({
      key: 'delete',
      label: '删除',
      icon: <Trash2 className="h-4 w-4" />,
      onClick: handlers.onDelete,
      danger: true,
      separator: true,
      disabled: handlers.canDelete ? (item) => !handlers.canDelete!(item) : undefined,
    });
  }

  return actions;
}
