import { Plus, Save } from 'lucide-react';

import { Button } from '@/components/ui/button';

import type { DayPlanEffort, EffortRowData } from '../types';
import { EffortRow } from './EffortRow';

interface PlanEditorProps {
  targetDate: string;
  planEffort: DayPlanEffort;
  saving: boolean;
  hasUnsavedChanges: boolean;
  onAddRow: () => void;
  onRemoveRow: (tempId: string) => void;
  onUpdateRow: (tempId: string, field: keyof EffortRowData, value: string | number | null) => void;
  onUpdateRowPatch: (tempId: string, patch: Partial<EffortRowData>) => void;
  onSave: () => void;
}

export function PlanEditor({
  targetDate,
  planEffort,
  saving,
  hasUnsavedChanges,
  onAddRow,
  onRemoveRow,
  onUpdateRow,
  onUpdateRowPatch,
  onSave,
}: PlanEditorProps) {
  const activeRows = planEffort.records.filter((r) => r._status !== 'deleted');
  const formattedDate = new Date(targetDate + 'T00:00:00').toLocaleDateString('zh-CN', {
    month: 'long',
    day: 'numeric',
    weekday: 'long',
  });
  const actionButtons = (
    <div className="flex flex-wrap items-center gap-2">
      <Button variant="outline" size="sm" onClick={onAddRow}>
        <Plus className="mr-1.5 h-3.5 w-3.5" />
        添加一行
      </Button>
      <Button size="sm" onClick={onSave} disabled={saving || !hasUnsavedChanges}>
        <Save className="mr-1.5 h-3.5 w-3.5" />
        {saving ? '保存中...' : '保存计划'}
      </Button>
    </div>
  );

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="space-y-0.5">
          <h3 className="text-base font-medium">明日计划 ({formattedDate})</h3>
          {planEffort.totalPlannedHours > 0 && (
            <p className="text-xs text-muted-foreground">
              预估合计 {planEffort.totalPlannedHours.toFixed(1)}h
            </p>
          )}
        </div>
      </div>

      {/* Rows */}
      <div className="space-y-2">
        {activeRows.length === 0 ? (
          <div className="flex items-center justify-center rounded-lg border border-dashed py-6 text-muted-foreground">
            <p className="text-sm">暂无明日计划</p>
          </div>
        ) : (
          activeRows.map((row) => (
            <EffortRow
              key={row.tempId}
              row={row}
              mode="plan"
              onUpdate={(field, value) => onUpdateRow(row.tempId, field, value)}
              onUpdatePatch={(patch) => onUpdateRowPatch(row.tempId, patch)}
              onRemove={() => onRemoveRow(row.tempId)}
            />
          ))
        )}
      </div>

      <div className="flex justify-start border-t pt-4">{actionButtons}</div>
    </div>
  );
}
