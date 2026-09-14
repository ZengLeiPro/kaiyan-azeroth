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
import type {
  FilterControlKind,
  FilterRegistryFieldMeta,
} from '@ky-azeroth/shared/schemas/filter-scheme';
import { GripVertical, Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

import type { FilterSchemeDraft } from '../types';

export interface EnabledFieldsEditorProps {
  fields: FilterSchemeDraft['fields'];
  registryFieldMap: Map<string, FilterRegistryFieldMeta>;
  onReorder: (next: FilterSchemeDraft['fields']) => void;
  onControlChange: (fieldKey: string, control: FilterControlKind) => void;
  onRemove: (fieldKey: string) => void;
}

export function EnabledFieldsEditor({
  fields,
  registryFieldMap,
  onReorder,
  onControlChange,
  onRemove,
}: EnabledFieldsEditorProps) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = fields.findIndex((f) => f.fieldKey === active.id);
    const newIndex = fields.findIndex((f) => f.fieldKey === over.id);
    if (oldIndex === -1 || newIndex === -1) return;
    onReorder(arrayMove(fields, oldIndex, newIndex));
  };

  if (fields.length === 0) {
    return (
      <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
        尚未启用任何筛选字段。请从下方"可添加字段"中选择。
      </div>
    );
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={fields.map((f) => f.fieldKey)} strategy={verticalListSortingStrategy}>
        <ul className="space-y-2">
          {fields.map((field) => {
            const meta = registryFieldMap.get(field.fieldKey);
            return (
              <SortableRow
                key={field.fieldKey}
                fieldKey={field.fieldKey}
                label={meta?.label ?? field.fieldKey}
                control={field.control}
                allowedControls={meta?.allowedControls ?? [field.control]}
                onControlChange={(control) => onControlChange(field.fieldKey, control)}
                onRemove={() => onRemove(field.fieldKey)}
              />
            );
          })}
        </ul>
      </SortableContext>
    </DndContext>
  );
}

interface SortableRowProps {
  fieldKey: string;
  label: string;
  control: FilterControlKind;
  allowedControls: FilterControlKind[];
  onControlChange: (control: FilterControlKind) => void;
  onRemove: () => void;
}

const CONTROL_LABELS: Record<FilterControlKind, string> = {
  text: '文本输入',
  select: '单选下拉',
  multiSelect: '多选下拉',
  entitySelect: '实体单选',
  entityMultiSelect: '实体多选',
  date: '单日期',
  dateRange: '日期范围',
  numberEqual: '数字等值',
  numberRange: '数字范围',
  switch: '开关',
};

function SortableRow({
  fieldKey,
  label,
  control,
  allowedControls,
  onControlChange,
  onRemove,
}: SortableRowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: fieldKey,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <li
      ref={setNodeRef}
      style={style}
      className={cn(
        'flex items-center gap-3 rounded-md border bg-card px-3 py-2',
        isDragging && 'opacity-50 shadow-lg'
      )}
    >
      <button
        type="button"
        className="cursor-grab text-muted-foreground hover:text-foreground active:cursor-grabbing"
        aria-label="拖拽排序"
        {...attributes}
        {...listeners}
      >
        <GripVertical className="h-4 w-4" />
      </button>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{label}</div>
        <div className="truncate text-xs text-muted-foreground">{fieldKey}</div>
      </div>
      <select
        value={control}
        onChange={(e) => onControlChange(e.target.value as FilterControlKind)}
        className="h-8 w-36 rounded-md border bg-background px-2 text-sm"
      >
        {allowedControls.map((c) => (
          <option key={c} value={c}>
            {CONTROL_LABELS[c]}
          </option>
        ))}
      </select>
      <Button type="button" variant="ghost" size="icon" onClick={onRemove} aria-label="移除">
        <Trash2 className="h-4 w-4 text-destructive" />
      </Button>
    </li>
  );
}
