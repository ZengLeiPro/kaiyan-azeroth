import { Pencil, Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import type { DrawerDetailMode } from '@/hooks/use-drawer-entity-detail';

export interface EntityHeaderActionsProps {
  mode: DrawerDetailMode;
  saving: boolean;
  onEnterEdit: () => void;
  onExitEdit: () => void;
  onSave: () => void;
  onRequestDelete: () => void;
  /** 是否允许删除（部分实体在特定状态下禁删，默认 true） */
  canDelete?: boolean;
  /** 是否允许进入编辑（部分实体在特定状态下禁编辑，默认 true） */
  canEdit?: boolean;
}

/**
 * 二级抽屉 Header 右上角的操作按钮组：
 * - view 模式：`[删除] [编辑]`（与一级 FormDialog 顺序一致）
 * - edit 模式：`[取消] [保存]`
 *
 * 每个实体通过 useEntityHeaderActions 把本组件注册到 DrawerStackHost Header 槽位。
 */
export function EntityHeaderActions({
  mode,
  saving,
  onEnterEdit,
  onExitEdit,
  onSave,
  onRequestDelete,
  canDelete = true,
  canEdit = true,
}: EntityHeaderActionsProps) {
  if (mode === 'edit') {
    return (
      <>
        <Button type="button" variant="outline" size="sm" onClick={onExitEdit} disabled={saving}>
          取消
        </Button>
        <Button type="button" size="sm" onClick={onSave} disabled={saving}>
          {saving ? '保存中...' : '保存'}
        </Button>
      </>
    );
  }
  return (
    <>
      {canDelete && (
        <Button type="button" variant="destructive" size="sm" onClick={onRequestDelete}>
          <Trash2 className="mr-1 h-3.5 w-3.5" />
          删除
        </Button>
      )}
      {canEdit && (
        <Button type="button" size="sm" onClick={onEnterEdit}>
          <Pencil className="mr-1 h-3.5 w-3.5" />
          编辑
        </Button>
      )}
    </>
  );
}
