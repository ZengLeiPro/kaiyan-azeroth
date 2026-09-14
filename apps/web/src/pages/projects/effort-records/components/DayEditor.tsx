import { Plus, Save } from 'lucide-react';

import { Button } from '@/components/ui/button';

import type { DayEffort, EffortRowData } from '../types';
import { ApplyPlanButton } from './ApplyPlanButton';
import { CopyYesterdayButton } from './CopyYesterdayButton';
import { DailyTotalIndicator } from './DailyTotalIndicator';
import { EffortRow } from './EffortRow';

interface DayEditorProps {
  date: string;
  dayEffort: DayEffort;
  saving: boolean;
  hasUnsavedChanges: boolean;
  onAddRow: () => void;
  onRemoveRow: (tempId: string) => void;
  onUpdateRow: (tempId: string, field: keyof EffortRowData, value: string | number | null) => void;
  onUpdateRowPatch: (tempId: string, patch: Partial<EffortRowData>) => void;
  onCopyYesterday: () => void;
  onApplyPlan: () => void;
  hasPlanForToday: boolean;
  onSave: () => void;
}

export function DayEditor({
  date,
  dayEffort,
  saving,
  hasUnsavedChanges,
  onAddRow,
  onRemoveRow,
  onUpdateRow,
  onUpdateRowPatch,
  onCopyYesterday,
  onApplyPlan,
  hasPlanForToday,
  onSave,
}: DayEditorProps) {
  const activeRows = dayEffort.records.filter((r) => r._status !== 'deleted');
  const formattedDate = new Date(date).toLocaleDateString('zh-CN', {
    year: 'numeric',
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
        {saving ? '保存中...' : '保存'}
      </Button>
    </div>
  );

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="space-y-0.5">
          <h3 className="text-base font-medium">{formattedDate}</h3>
          <DailyTotalIndicator totalHours={dayEffort.totalHours} />
        </div>
        <div className="flex items-center gap-2">
          <CopyYesterdayButton onClick={onCopyYesterday} />
          <ApplyPlanButton onClick={onApplyPlan} disabled={!hasPlanForToday} />
        </div>
      </div>

      {/* Rows */}
      <div className="space-y-2">
        {activeRows.length === 0 ? (
          <div className="flex items-center justify-center rounded-lg border border-dashed py-8 text-muted-foreground">
            <p className="text-sm">今日暂无工时记录</p>
          </div>
        ) : (
          activeRows.map((row) => (
            <EffortRow
              key={row.tempId}
              row={row}
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
