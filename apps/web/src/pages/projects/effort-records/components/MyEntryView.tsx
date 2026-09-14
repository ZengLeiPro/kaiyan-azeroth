import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useEffect, useMemo, useRef } from 'react';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useIsMobile } from '@/hooks/use-mobile';
import { cn } from '@/lib/utils';

import { useMyEffort } from '../hooks/use-my-effort';
import { DayEditor } from './DayEditor';
import { PlanEditor } from './PlanEditor';
import { WeekStatusBar } from './WeekStatusBar';

interface MyEntryViewProps {
  onDirtyChange: (dirty: boolean) => void;
}

export function MyEntryView({ onDirtyChange }: MyEntryViewProps) {
  const isMobile = useIsMobile();

  const {
    weekDates,
    weekStartStr,
    weekEndStr,
    selectedDate,
    setSelectedDate,
    dayEfforts,
    currentDayEffort,
    isLoading,
    isError,
    refetch,
    addRow,
    removeRow,
    updateRow,
    updateRowPatch,
    copyYesterday,
    save,
    saving,
    hasUnsavedChanges,
    hasAnyUnsavedChanges,
    // Plan
    planDayEfforts,
    currentDayPlanEffort,
    nextDate,
    addPlanRow,
    removePlanRow,
    updatePlanRow,
    updatePlanRowPatch,
    savePlan,
    savingPlan,
    hasPlanUnsavedChanges,
    hasAnyPlanUnsavedChanges,
    applyYesterdayPlan,
    hasPlanForSelectedDate,
    // Navigation
    goToPrevWeek,
    goToNextWeek,
    goToCurrentWeek,
  } = useMyEffort();

  // Sync dirty state to parent — only when value actually changes
  const dirtyRef = useRef(false);
  const isDirty = hasAnyUnsavedChanges() || hasAnyPlanUnsavedChanges();
  useEffect(() => {
    if (dirtyRef.current !== isDirty) {
      dirtyRef.current = isDirty;
      onDirtyChange(isDirty);
    }
  }, [isDirty, onDirtyChange]);

  // Compute planDates set for WeekStatusBar
  const planDates = useMemo(() => {
    const set = new Set<string>();
    for (const [targetDate, planEffort] of planDayEfforts) {
      if (planEffort.records.filter((r) => r._status !== 'deleted').length > 0) {
        set.add(targetDate);
      }
    }
    return set;
  }, [planDayEfforts]);

  const weekLabel = `${weekStartStr.slice(5).replace('-', '/')} - ${weekEndStr.slice(5).replace('-', '/')}`;

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      {/* Week navigation */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" onClick={goToPrevWeek} title="上一周">
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={goToCurrentWeek}
            className="min-w-[7rem] text-center"
          >
            {weekLabel}
          </Button>
          <Button variant="ghost" size="icon" onClick={goToNextWeek} title="下一周">
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Week status bar */}
      <Card>
        <CardContent className="p-3">
          <WeekStatusBar
            weekDates={weekDates}
            dayEfforts={dayEfforts}
            selectedDate={selectedDate}
            onSelectDate={setSelectedDate}
            planDates={planDates}
          />
        </CardContent>
      </Card>

      {/* Day editor + Plan editor */}
      {isError ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center gap-3 py-12">
            <span className="text-sm text-muted-foreground">加载失败</span>
            <Button variant="outline" size="sm" onClick={() => refetch()}>
              重试
            </Button>
          </CardContent>
        </Card>
      ) : isLoading ? (
        <Card>
          <CardContent className="flex items-center justify-center py-12">
            <span className="text-sm text-muted-foreground">加载中...</span>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* ACTUAL: 今日工时 */}
          <Card>
            <CardContent className={cn('p-4', isMobile && 'p-3')}>
              <DayEditor
                date={selectedDate}
                dayEffort={currentDayEffort}
                saving={saving}
                hasUnsavedChanges={hasUnsavedChanges(selectedDate)}
                onAddRow={() => addRow(selectedDate)}
                onRemoveRow={(tempId) => removeRow(selectedDate, tempId)}
                onUpdateRow={(tempId, field, value) =>
                  updateRow(selectedDate, tempId, field, value)
                }
                onUpdateRowPatch={(tempId, patch) => updateRowPatch(selectedDate, tempId, patch)}
                onCopyYesterday={() => copyYesterday(selectedDate)}
                onApplyPlan={() => applyYesterdayPlan(selectedDate)}
                hasPlanForToday={hasPlanForSelectedDate}
                onSave={() => save(selectedDate)}
              />
            </CardContent>
          </Card>

          {/* PLAN: 明日计划 */}
          <Card>
            <CardContent className={cn('p-4', isMobile && 'p-3')}>
              <PlanEditor
                targetDate={nextDate}
                planEffort={currentDayPlanEffort}
                saving={savingPlan}
                hasUnsavedChanges={hasPlanUnsavedChanges(nextDate)}
                onAddRow={() => addPlanRow(nextDate)}
                onRemoveRow={(tempId) => removePlanRow(nextDate, tempId)}
                onUpdateRow={(tempId, field, value) =>
                  updatePlanRow(nextDate, tempId, field, value)
                }
                onUpdateRowPatch={(tempId, patch) => updatePlanRowPatch(nextDate, tempId, patch)}
                onSave={() => savePlan(nextDate)}
              />
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
