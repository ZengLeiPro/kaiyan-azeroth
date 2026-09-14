import { useEffect } from 'react';

import type { UseDrawerEntityDetailReturn } from '@/hooks/use-drawer-entity-detail';

import { EntityHeaderActions } from './EntityHeaderActions';
import { useSetDrawerHeaderActions } from './header-actions-context';

interface UseEntityHeaderActionsExtra {
  /** 是否允许编辑（部分实体在特定状态下禁编辑），默认 true */
  canEdit?: boolean;
  /** 是否允许删除（部分实体在特定状态下禁删），默认 true */
  canDelete?: boolean;
}

/**
 * 把 useDrawerEntityDetail 的状态/回调上推到 DrawerStackHost Header 渲染按钮。
 *
 * 在每个实体的 DetailView 中调用一次即可：
 * ```ts
 * const crud = useDrawerEntityDetail(...);
 * useEntityHeaderActions(crud);
 * ```
 *
 * 内部细节：
 * - 当 data 还在加载或加载失败时不渲染 actions（避免对一个不存在的实体显示「编辑/删除」）。
 * - 卸载时清空 actions（避免栈切换后旧按钮残留）。
 */

export function useEntityHeaderActions<TResp, TForm>(
  crud: UseDrawerEntityDetailReturn<TResp, TForm>,
  extra: UseEntityHeaderActionsExtra = {}
): void {
  const setActions = useSetDrawerHeaderActions();
  const {
    mode,
    saving,
    data,
    loading,
    error,
    enterEditMode,
    exitEditMode,
    handleSave,
    requestDelete,
  } = crud;
  const { canEdit = true, canDelete = true } = extra;

  useEffect(() => {
    if (loading || error || !data) {
      setActions(null);
      return;
    }
    setActions(
      <EntityHeaderActions
        mode={mode}
        saving={saving}
        canEdit={canEdit}
        canDelete={canDelete}
        onEnterEdit={enterEditMode}
        onExitEdit={exitEditMode}
        onSave={handleSave}
        onRequestDelete={requestDelete}
      />
    );
    return () => setActions(null);
  }, [
    setActions,
    mode,
    saving,
    data,
    loading,
    error,
    canEdit,
    canDelete,
    enterEditMode,
    exitEditMode,
    handleSave,
    requestDelete,
  ]);
}
