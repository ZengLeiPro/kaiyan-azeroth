import type {
  FilterFieldDataType,
  FilterRegistryFieldMeta,
} from '@ky-azeroth/shared/schemas/filter-scheme';
import type { LucideIcon } from 'lucide-react';
import { Calendar, Hash, Link2, List, Plus, ToggleLeft, Type } from 'lucide-react';

import { Button } from '@/components/ui/button';

import { DATA_TYPE_LABELS } from '../types';

export interface AddableFieldsPanelProps {
  allFields: FilterRegistryFieldMeta[];
  enabledFieldKeys: Set<string>;
  onAdd: (field: FilterRegistryFieldMeta) => void;
}

const DATA_TYPE_ICONS: Record<FilterFieldDataType, LucideIcon> = {
  enum: List,
  string: Type,
  date: Calendar,
  foreignKey: Link2,
  decimal: Hash,
  int: Hash,
  boolean: ToggleLeft,
};

export function AddableFieldsPanel({
  allFields,
  enabledFieldKeys,
  onAdd,
}: AddableFieldsPanelProps) {
  const available = allFields.filter((f) => !enabledFieldKeys.has(f.fieldKey));

  if (available.length === 0) {
    return (
      <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
        所有字段都已启用
      </div>
    );
  }

  const grouped = new Map<FilterFieldDataType, FilterRegistryFieldMeta[]>();
  for (const field of available) {
    const arr = grouped.get(field.dataType) ?? [];
    arr.push(field);
    grouped.set(field.dataType, arr);
  }

  const orderedGroups: FilterFieldDataType[] = [
    'enum',
    'foreignKey',
    'date',
    'string',
    'decimal',
    'int',
    'boolean',
  ];

  return (
    <div className="space-y-4">
      {orderedGroups.map((dataType) => {
        const fields = grouped.get(dataType);
        if (!fields || fields.length === 0) return null;
        const Icon = DATA_TYPE_ICONS[dataType];
        return (
          <div key={dataType}>
            <div className="mb-2 flex items-center gap-2 text-xs font-medium text-muted-foreground">
              <Icon className="h-3.5 w-3.5" />
              <span>{DATA_TYPE_LABELS[dataType]}</span>
            </div>
            <div className="flex flex-wrap gap-2">
              {fields.map((field) => (
                <Button
                  key={field.fieldKey}
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => onAdd(field)}
                  className="h-8"
                  title={`${field.label} (${field.fieldKey})`}
                >
                  <Plus className="mr-1 h-3.5 w-3.5" />
                  {field.label}
                </Button>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
