import { Trash2 } from 'lucide-react';
import { useEffect, useRef } from 'react';

import {
  ProjectQuickPicker,
  type ProjectQuickPickerOption,
} from '@/components/patterns/project-quick-picker';
import { WorkTypeSelect } from '@/components/patterns/work-type-select';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useIsMobile } from '@/hooks/use-mobile';
import { cn } from '@/lib/utils';

import type { EffortRowData } from '../types';

interface EffortRowProps {
  row: EffortRowData;
  onUpdate: (field: keyof EffortRowData, value: string | number | null) => void;
  onUpdatePatch: (patch: Partial<EffortRowData>) => void;
  onRemove: () => void;
  /** 模式：actual=实际工时，plan=工作计划 */
  mode?: 'actual' | 'plan';
}

// 描述字段专用：单行起始、内容超宽或换行时自动向下扩展
function AutoGrowTextarea({
  className,
  value,
  onChange,
  ...props
}: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);

  return (
    <textarea
      ref={ref}
      rows={1}
      value={value}
      onChange={onChange}
      className={cn(
        'flex min-h-9 w-full resize-none overflow-hidden rounded-md border border-input bg-transparent px-3 py-1.5 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50',
        className
      )}
      {...props}
    />
  );
}

export function EffortRow({
  row,
  onUpdate,
  onUpdatePatch,
  onRemove,
  mode = 'actual',
}: EffortRowProps) {
  const isMobile = useIsMobile();
  const hoursLabel = mode === 'plan' ? '预估(h)' : '工时(h)';
  const descLabel = mode === 'plan' ? '计划内容' : '描述';
  const descPlaceholder = mode === 'plan' ? '请简要描述计划内容' : '请简要描述工作内容';
  const customerName = row.customerName || '-';
  const handleProjectChange = (projectId: string, project?: ProjectQuickPickerOption | null) => {
    onUpdatePatch({
      projectId,
      projectName: project?.name ?? '',
      customerName: project?.customerName ?? '',
    });
  };

  if (isMobile) {
    return (
      <div className="space-y-2.5 rounded-lg border bg-muted/30 p-3">
        {/* Project */}
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">项目</label>
          <ProjectQuickPicker
            value={row.projectId}
            onChange={handleProjectChange}
            showCustomerInLabel
          />
        </div>

        {/* Customer */}
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">客户</label>
          <Input
            value={customerName}
            readOnly
            disabled
            className="h-9 bg-muted/60 text-muted-foreground"
          />
        </div>

        {/* Hours + Type */}
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">{hoursLabel}</label>
            <Input
              type="number"
              step="0.5"
              min="0"
              placeholder="0"
              value={row.actualTime || ''}
              onChange={(e) => onUpdate('actualTime', e.target.value ? Number(e.target.value) : 0)}
              className="h-9"
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">类型</label>
            <WorkTypeSelect
              value={row.workType}
              onChange={(val) => onUpdate('workType', val)}
              placeholder="选择类型"
            />
          </div>
        </div>

        {/* Description + Delete */}
        <div className="flex items-end gap-2">
          <div className="min-w-0 flex-1 space-y-1">
            <label className="text-xs text-muted-foreground">{descLabel}</label>
            <AutoGrowTextarea
              placeholder={descPlaceholder}
              value={row.description ?? ''}
              onChange={(e) => onUpdate('description', e.target.value)}
            />
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-9 w-9 shrink-0 text-muted-foreground hover:text-destructive"
            onClick={onRemove}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>
    );
  }

  // Desktop layout
  return (
    <div className="flex items-start gap-2 rounded-lg border bg-muted/30 p-3">
      {/* Project - takes most space */}
      <div className="min-w-0 flex-1 space-y-1">
        <label className="text-xs text-muted-foreground">项目</label>
        <ProjectQuickPicker
          value={row.projectId}
          onChange={handleProjectChange}
          showCustomerInLabel
        />
      </div>

      {/* Customer */}
      <div className="w-40 shrink-0 space-y-1">
        <label className="text-xs text-muted-foreground">客户</label>
        <Input
          value={customerName}
          readOnly
          disabled
          className="h-9 bg-muted/60 text-muted-foreground"
        />
      </div>

      {/* Hours */}
      <div className="w-24 shrink-0 space-y-1">
        <label className="text-xs text-muted-foreground">工时(h)</label>
        <Input
          type="number"
          step="0.5"
          min="0"
          placeholder="0"
          value={row.actualTime || ''}
          onChange={(e) => onUpdate('actualTime', e.target.value ? Number(e.target.value) : 0)}
          className="h-9"
        />
      </div>

      {/* Type */}
      <div className="w-32 shrink-0 space-y-1">
        <label className="text-xs text-muted-foreground">类型</label>
        <WorkTypeSelect
          value={row.workType}
          onChange={(val) => onUpdate('workType', val)}
          placeholder="选择类型"
        />
      </div>

      {/* Description */}
      <div className={cn('min-w-0 flex-1 space-y-1')}>
        <label className="text-xs text-muted-foreground">描述</label>
        <AutoGrowTextarea
          placeholder={descPlaceholder}
          value={row.description ?? ''}
          onChange={(e) => onUpdate('description', e.target.value)}
        />
      </div>

      {/* Delete */}
      <div className="shrink-0 pt-5">
        <Button
          variant="ghost"
          size="icon"
          className="h-9 w-9 text-muted-foreground hover:text-destructive"
          onClick={onRemove}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
