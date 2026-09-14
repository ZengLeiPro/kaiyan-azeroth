import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical, Settings2, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ColumnConfig } from '@/hooks/use-column-visibility';
import { dispatchColumnWidthsReset, readCurrentColumnWidths } from '@/hooks/use-column-widths';
import { getErrorMessage } from '@/lib/api';
import { buildTablePreferencePageKey, saveTablePreference } from '@/lib/table-preferences';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/stores/auth';

// 列设置下拉组件 Props
interface ColumnVisibilityDropdownProps {
  columns: ColumnConfig[];
  onToggle: (key: string) => void;
  onShowAll?: () => void;
  /**
   * 真正的"恢复默认显隐"（清 localStorage + 按 initialColumns 原值还原），
   * 区别于 `onShowAll`（全开并持久化）。优先级：若提供则"重置表格"菜单走此回调。
   */
  onResetVisibility?: () => void;
  /** 当前 DataTable 的 storageId（与 useColumnWidths 的 options.storageId 对齐），用于重置列宽事件 */
  storageId?: string;
  /**
   * 管理员推送成功后通知 hook 同步本地 appliedServerVersion，避免管理员自己页面下次刷新被"再覆盖一次"。
   * 可选——未传也不影响功能，只是会多走一次无害的强制覆盖。
   */
  onServerVersionApplied?: (version: number) => void;
  /**
   * 拖拽改变列顺序时回调，传入新的列 key 顺序数组。
   * 不传则不渲染拖拽手柄（保留旧行为）。
   */
  onReorder?: (newKeyOrder: string[]) => void;
  // ============ 排序状态推送（一锅端模式：sortBy 非空就一起推） ============
  /** 当前页面 sorting state 的 sortBy（来自 crud.sorting.sortBy）；未传或为空 → 不推送排序 */
  currentSortBy?: string;
  /** 当前页面 sorting state 的 sortOrder */
  currentSortOrder?: 'asc' | 'desc';
  /**
   * 本页可排序的字段集合（来自 `columns.filter(c=>c.sortable).map(c=>c.sortKey||c.key)`）。
   * admin 保存时校验 currentSortBy 是否在白名单中，不在则拒绝保存（防止推送已下架字段）。
   * 同时传给"管理员操作"区域用于展示当前推送的排序列 label。
   */
  sortableKeys?: string[];
  /** admin 推送成功后通知 useServerPagination.sorting 同步 appliedServerVersion */
  onServerSortingVersionApplied?: (version: number) => void;
}

/** 单行可拖拽列项：drag handle + checkbox + label。不使用 Radix MenuItem，避免事件冲突。 */
function SortableColumnRow({
  column,
  onToggle,
  draggable,
}: {
  column: ColumnConfig;
  onToggle: () => void;
  draggable: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: column.key,
    disabled: !draggable,
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };
  const disabled = column.canHide === false;
  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        'flex select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm',
        !isDragging && 'hover:bg-accent'
      )}
      data-testid={`column-row-${column.key}`}
    >
      {draggable ? (
        <button
          type="button"
          className="cursor-grab touch-none p-0.5 text-muted-foreground outline-none focus-visible:ring-1 focus-visible:ring-ring"
          aria-label={`拖动 ${column.label} 调整顺序`}
          {...attributes}
          {...listeners}
        >
          <GripVertical className="h-4 w-4" />
        </button>
      ) : (
        <span className="w-5" />
      )}
      <Checkbox
        checked={column.visible}
        onCheckedChange={() => onToggle()}
        disabled={disabled}
        aria-label={column.label}
        data-testid={`toggle-column-${column.key}`}
      />
      <span
        className={cn('flex-1 cursor-default text-left', disabled && 'text-muted-foreground')}
        onClick={() => {
          if (!disabled) onToggle();
        }}
      >
        {column.label}
      </span>
    </div>
  );
}

// 列设置下拉组件
export function ColumnVisibilityDropdown({
  columns,
  onToggle,
  onShowAll,
  onResetVisibility,
  storageId,
  onServerVersionApplied,
  onReorder,
  currentSortBy,
  currentSortOrder,
  sortableKeys,
  onServerSortingVersionApplied,
}: ColumnVisibilityDropdownProps) {
  const canPushSitePreference = useAuthStore((s) =>
    s.hasMenuPermission('system', 'filter_schemes', 'edit')
  );
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  // 打开确认对话框瞬间冻结的推送 snapshot；关闭对话框时清空。
  const [pushSnapshot, setPushSnapshot] = useState<{
    visibility: Record<string, boolean>;
    widths: Record<string, number>;
    order: string[];
    totalCols: number;
    visibleCols: number;
    hasCustomOrder: boolean;
    sortBy?: string;
    sortOrder?: 'asc' | 'desc';
    /** 推送的排序列 label（仅 UI 展示用） */
    sortByLabel?: string;
    hasCustomSort: boolean;
  } | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const handleResetWidths = () => {
    dispatchColumnWidthsReset(storageId);
  };

  const handleResetTable = () => {
    // 1. 清当前表的列宽（走事件 + removeItem 双通道，保证不被防抖覆写）
    dispatchColumnWidthsReset(storageId);
    // 2. 恢复列显隐+顺序到 schema/config 的默认值（优先 resetToDefault，回退到 showAll）
    if (onResetVisibility) {
      onResetVisibility();
    } else {
      onShowAll?.();
    }
  };

  const hasResetTable = Boolean(onResetVisibility ?? onShowAll);

  const handleDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    if (!onReorder) return;
    const oldIndex = columns.findIndex((c) => c.key === active.id);
    const newIndex = columns.findIndex((c) => c.key === over.id);
    if (oldIndex < 0 || newIndex < 0) return;
    const newKeyOrder = arrayMove(columns, oldIndex, newIndex).map((c) => c.key);
    onReorder(newKeyOrder);
  };

  const handleOpenConfirm = () => {
    // 点击瞬间冻结 snapshot：包含本地 widths + 当前 columns visible 状态 + 列顺序 + 当前排序
    const visibility: Record<string, boolean> = {};
    for (const col of columns) {
      visibility[col.key] = col.visible;
    }
    const currentOrder = columns.map((col) => col.key);

    // 排序快照：仅当 currentSortBy 非空且命中本地 sortable 白名单时才推送；
    // 白名单不命中直接拦截在 admin 端（防止推送已下架字段，避免普通用户 UI/数据不一致）。
    // 白名单：优先 props，回退到从 columns 自动派生（要求 ColumnConfig 携带 sortable 元数据）
    const allowed =
      sortableKeys ?? columns.filter((c) => c.sortable).map((c) => c.sortKey ?? c.key);
    const sortByCandidate = currentSortBy?.trim();
    let sortBy: string | undefined;
    let sortOrder: 'asc' | 'desc' | undefined;
    let sortByLabel: string | undefined;
    if (sortByCandidate) {
      if (allowed.length === 0 || allowed.includes(sortByCandidate)) {
        sortBy = sortByCandidate;
        sortOrder = currentSortOrder ?? 'desc';
        // 找到对应列的 label 显示给 admin 看（按 key 或 sortKey 反查）
        const col = columns.find((c) => (c.sortKey ?? c.key) === sortByCandidate);
        sortByLabel = col?.label ?? sortByCandidate;
      } else {
        // 白名单不命中：admin 不应推送已下架字段，直接 toast 拒绝并中断
        toast.error(`当前排序字段「${sortByCandidate}」不在可排序列表内，无法保存为全员默认`);
        return;
      }
    }

    // 判断是否"已自定义顺序"：与 schema 原始顺序对比；这里 columns 已经是 hook 应用 order 后的
    // 我们没有 schema 原始顺序参照，简化：只要管理员推送过 order，就以当前顺序为准。
    setPushSnapshot({
      visibility,
      widths: readCurrentColumnWidths(storageId),
      order: currentOrder,
      totalCols: columns.length,
      visibleCols: columns.filter((c) => c.visible).length,
      hasCustomOrder: Boolean(onReorder),
      sortBy,
      sortOrder,
      sortByLabel,
      hasCustomSort: Boolean(sortBy),
    });
    setConfirmOpen(true);
  };

  const handleConfirmSave = async () => {
    if (submitting || !pushSnapshot) return;
    setSubmitting(true);
    try {
      const pageKey = buildTablePreferencePageKey(window.location.pathname, storageId);
      const result = await saveTablePreference(pageKey, {
        visibility: pushSnapshot.visibility,
        widths: pushSnapshot.widths,
        ...(pushSnapshot.hasCustomOrder ? { order: pushSnapshot.order } : {}),
        ...(pushSnapshot.hasCustomSort && pushSnapshot.sortBy
          ? { sortBy: pushSnapshot.sortBy, sortOrder: pushSnapshot.sortOrder ?? 'desc' }
          : {}),
      });
      onServerVersionApplied?.(result.version);
      onServerSortingVersionApplied?.(result.version);
      setConfirmOpen(false);
      setPushSnapshot(null);
      toast.success(`已保存为全员默认（v${result.version}）`);
    } catch (err) {
      toast.error(getErrorMessage(err, '保存失败'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" className="h-8" data-testid="column-settings-btn">
            <Settings2 className="mr-2 h-4 w-4" />
            列设置
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent className="w-64" align="end" data-testid="column-settings-popover">
          <DropdownMenuLabel>
            {onReorder ? '显示 / 隐藏列（可拖拽调整顺序）' : '显示 / 隐藏列'}
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <div className="max-h-[min(400px,50vh)] overflow-y-auto">
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleDragEnd}
            >
              <SortableContext
                items={columns.map((c) => c.key)}
                strategy={verticalListSortingStrategy}
              >
                {columns.map((column) => (
                  <SortableColumnRow
                    key={column.key}
                    column={column}
                    onToggle={() => onToggle(column.key)}
                    draggable={Boolean(onReorder)}
                  />
                ))}
              </SortableContext>
            </DndContext>
          </div>
          {onShowAll && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onSelect={(e) => {
                  e.preventDefault();
                  onShowAll();
                }}
                data-testid="show-all-columns-btn"
              >
                显示所有列
              </DropdownMenuItem>
            </>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={(e) => {
              e.preventDefault();
              handleResetWidths();
            }}
            data-testid="reset-column-widths-btn"
          >
            重置列宽
          </DropdownMenuItem>
          {hasResetTable && (
            <DropdownMenuItem
              onSelect={(e) => {
                e.preventDefault();
                handleResetTable();
              }}
              data-testid="reset-table-btn"
            >
              重置表格（列宽 + 显隐 + 顺序）
            </DropdownMenuItem>
          )}
          {canPushSitePreference && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuLabel className="text-xs text-muted-foreground">
                管理员操作
              </DropdownMenuLabel>
              <DropdownMenuItem
                onSelect={(e) => {
                  e.preventDefault();
                  handleOpenConfirm();
                }}
                data-testid="save-as-global-default-btn"
              >
                <ShieldCheck className="mr-2 h-4 w-4" />
                保存为全员默认…
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialog
        open={confirmOpen}
        onOpenChange={(open) => {
          setConfirmOpen(open);
          if (!open) setPushSnapshot(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>推送为全员默认</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm">
                <p>
                  此操作将把当前【列显隐】+【列宽】
                  {pushSnapshot?.hasCustomOrder ? '+【列顺序】' : ''}
                  {pushSnapshot?.hasCustomSort ? '+【默认排序】' : ''}
                  推送给所有用户，并
                  <span className="font-semibold text-foreground">强制覆盖</span>
                  每个人浏览器里已有的本地自定义。
                </p>
                {pushSnapshot && (
                  <ul className="list-disc pl-5 text-muted-foreground">
                    <li>
                      列显隐：共 {pushSnapshot.totalCols} 列（其中 {pushSnapshot.visibleCols}{' '}
                      列显示）
                    </li>
                    <li>列宽：已自定义 {Object.keys(pushSnapshot.widths).length} 列</li>
                    {pushSnapshot.hasCustomOrder && (
                      <li>列顺序：当前展示顺序（共 {pushSnapshot.order.length} 列）</li>
                    )}
                    {pushSnapshot.hasCustomSort && (
                      <li>
                        默认排序：按【{pushSnapshot.sortByLabel}】
                        {pushSnapshot.sortOrder === 'asc' ? '升序 ↑' : '降序 ↓'}
                      </li>
                    )}
                  </ul>
                )}
                <p className="text-muted-foreground">
                  普通用户下次进入此页面时生效；推送后他们仍可继续个人调整，直到下一次推送。
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={submitting}>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void handleConfirmSave();
              }}
              disabled={submitting}
            >
              {submitting ? '保存中…' : '确认推送'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
