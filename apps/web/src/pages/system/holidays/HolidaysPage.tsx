import { isValidIsoDate } from '@ky-azeroth/shared/schemas';
import { useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, CopyPlus, RotateCcw, Save } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';

import { StandardToolbar } from '@/components/patterns/standard-toolbar';
import { StandardLayout } from '@/components/templates/standard-layout';
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
import { api, getErrorMessage } from '@/lib/api';

import { holidaysQueryKey, useHolidaysQuery, usePublishHolidaysMutation } from './hooks';
import type { HolidayDraftMap, HolidayItem, HolidayListResponse } from './types';
import { cycleCellState, isWeekend, itemsToMap, toIso } from './types';
import { YearCalendarGrid } from './YearCalendarGrid';

const CURRENT_YEAR = new Date().getFullYear();

export function HolidaysPage() {
  const queryClient = useQueryClient();
  const [year, setYear] = useState<number>(CURRENT_YEAR);
  const [draft, setDraft] = useState<HolidayDraftMap>(new Map());
  const [dirty, setDirty] = useState(false);

  // 切年份确认 & 重置确认 & 复制上一年确认 & 清空发布确认
  const [pendingYear, setPendingYear] = useState<number | null>(null);
  const [resetConfirmOpen, setResetConfirmOpen] = useState(false);
  const [copyConfirmOpen, setCopyConfirmOpen] = useState(false);
  const [emptyPublishConfirmOpen, setEmptyPublishConfirmOpen] = useState(false);

  const yearQuery = useHolidaysQuery(year);
  const publishMutation = usePublishHolidaysMutation(year);

  // 数据加载后初始化 draft。
  // **重要**：dirty 时不覆盖用户未发布的草稿（staleTime 过后切回窗口的 refetch 会
  // 触发 yearQuery.data 变化，若无 !dirty 守卫会静默覆盖用户改动）。
  // 切年份时 dirty 必然已为 false（switchYear 已守卫），同步会照常发生。
  useEffect(() => {
    if (yearQuery.data && !dirty) {
      setDraft(itemsToMap(yearQuery.data.items));
    }
  }, [yearQuery.data, dirty]);

  // beforeunload 兜底
  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

  const stats = useMemo(() => computeStats(year, draft), [year, draft]);

  const handleCellClick = (date: Date) => {
    const iso = toIso(date);
    const next = new Map(draft);
    const current = next.get(iso);
    const updated = cycleCellState(date, current);
    if (updated === null) {
      next.delete(iso);
    } else {
      next.set(iso, updated);
    }
    setDraft(next);
    setDirty(true);
  };

  const switchYear = (target: number) => {
    if (dirty) {
      setPendingYear(target);
      return;
    }
    setYear(target);
  };

  const confirmSwitchYear = () => {
    if (pendingYear !== null) {
      setYear(pendingYear);
      setPendingYear(null);
    }
  };

  const handleReset = () => {
    if (!yearQuery.data) return;
    setDraft(itemsToMap(yearQuery.data.items));
    setDirty(false);
    toast.info('已重置为已发布版本');
  };

  const handleCopyPrevYear = () => {
    // dirty 时弹二次确认，避免覆盖未发布草稿
    if (dirty) {
      setCopyConfirmOpen(true);
      return;
    }
    void doCopyPrevYear();
  };

  const doCopyPrevYear = async () => {
    const prevYear = year - 1;
    try {
      const res = await api.get<HolidayListResponse>('/holidays', {
        params: { year: prevYear },
      });
      const items = res.data.items;
      if (items.length === 0) {
        toast.info(`${prevYear} 年没有可复制的节假日`);
        return;
      }
      // 平移同月同日到当前年；过滤掉非真实日历日（如非闰年的 2/29）
      const next: HolidayDraftMap = new Map();
      const skipped: string[] = [];
      for (const item of items) {
        const [, m, d] = item.date.split('-');
        const targetIso = `${year}-${m}-${d}`;
        if (!isValidIsoDate(targetIso)) {
          skipped.push(item.date);
          continue;
        }
        next.set(targetIso, {
          date: targetIso,
          type: item.type,
          note: item.note ?? null,
        });
      }
      setDraft(next);
      setDirty(true);
      const copiedCount = next.size;
      if (skipped.length > 0) {
        toast.success(
          `已从 ${prevYear} 年复制 ${copiedCount} 条，跳过 ${skipped.length} 条非闰年/非法日期（${skipped.join(', ')}），请确认后发布`
        );
      } else {
        toast.success(`已从 ${prevYear} 年复制 ${copiedCount} 条，请确认后点击发布`);
      }
    } catch (err) {
      toast.error(getErrorMessage(err, '复制上一年失败'));
    }
  };

  const handlePublish = async () => {
    // 空发布 + 当前 DB 有较多记录 → 二次确认（防误清空全年）
    const publishedCount = yearQuery.data?.items.length ?? 0;
    if (draft.size === 0 && publishedCount >= 5) {
      setEmptyPublishConfirmOpen(true);
      return;
    }
    await doPublish(false);
  };

  const doPublish = async (confirmEmpty: boolean) => {
    try {
      const items: HolidayItem[] = Array.from(draft.values()).sort((a, b) =>
        a.date.localeCompare(b.date)
      );
      const data = await publishMutation.mutateAsync({ items, confirmEmpty });
      setDraft(itemsToMap(data.items));
      setDirty(false);
      toast.success(`${year} 年节假日已发布`);
      await queryClient.invalidateQueries({ queryKey: holidaysQueryKey(year) });
    } catch (err) {
      toast.error(getErrorMessage(err, '发布失败'));
    }
  };

  return (
    <>
      <StandardLayout
        toolbar={
          <StandardToolbar
            leadingActions={
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => switchYear(year - 1)}
                  aria-label="上一年"
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <div className="min-w-[80px] text-center text-base font-semibold">{year} 年</div>
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => switchYear(year + 1)}
                  aria-label="下一年"
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            }
            filters={<Legend />}
            actions={
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  onClick={handleCopyPrevYear}
                  disabled={publishMutation.isPending}
                >
                  <CopyPlus className="mr-2 h-4 w-4" />
                  复制上一年
                </Button>
                <Button
                  variant="outline"
                  onClick={() => setResetConfirmOpen(true)}
                  disabled={!dirty || publishMutation.isPending}
                >
                  <RotateCcw className="mr-2 h-4 w-4" />
                  重置
                </Button>
                <Button
                  onClick={handlePublish}
                  disabled={!dirty || publishMutation.isPending}
                  className="bg-primary text-primary-foreground hover:bg-primary/90"
                >
                  <Save className="mr-2 h-4 w-4" />
                  {publishMutation.isPending ? '发布中...' : '发布'}
                </Button>
              </div>
            }
          />
        }
      >
        <div className="space-y-4">
          {/* 顶部统计胶囊 + 操作提示 */}
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <StatPill label="休息日" value={stats.restDays} />
            <StatPill label="工作日" value={stats.workDays} />
            <StatPill label="例外日" value={draft.size} highlight={dirty} />
            {dirty && (
              <span className="rounded-full bg-orange-500/10 px-3 py-1 text-xs text-orange-600 dark:text-orange-400">
                有未发布的修改
              </span>
            )}
            <span className="text-xs text-muted-foreground">
              点工作日变红（节假日），点周末变蓝（调休补班），再点清除
            </span>
          </div>

          {yearQuery.isLoading ? (
            <div className="rounded-md border p-6 text-center text-sm text-muted-foreground">
              加载中...
            </div>
          ) : yearQuery.isError ? (
            <div className="rounded-md border border-destructive/30 bg-destructive/5 p-6 text-sm text-destructive">
              加载失败：{getErrorMessage(yearQuery.error)}
            </div>
          ) : (
            <YearCalendarGrid year={year} draftMap={draft} onCellClick={handleCellClick} />
          )}
        </div>
      </StandardLayout>

      {/* 切年份确认 */}
      <AlertDialog
        open={pendingYear !== null}
        onOpenChange={(open) => {
          if (!open) setPendingYear(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>放弃未发布的修改？</AlertDialogTitle>
            <AlertDialogDescription>
              当前 {year} 年有未发布的改动，切到 {pendingYear} 年会丢弃这些改动。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction onClick={confirmSwitchYear}>放弃并切换</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* 重置确认 */}
      <AlertDialog open={resetConfirmOpen} onOpenChange={setResetConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>重置为已发布版本？</AlertDialogTitle>
            <AlertDialogDescription>
              将丢弃 {year} 年当前所有未发布的改动，恢复到上次发布的状态。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setResetConfirmOpen(false);
                handleReset();
              }}
            >
              确认重置
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* 复制上一年确认（dirty 时） */}
      <AlertDialog open={copyConfirmOpen} onOpenChange={setCopyConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>覆盖未发布的改动？</AlertDialogTitle>
            <AlertDialogDescription>
              当前 {year} 年有未发布的改动，从 {year - 1} 年复制会覆盖这些改动。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setCopyConfirmOpen(false);
                void doCopyPrevYear();
              }}
            >
              覆盖并复制
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* 空发布确认（draft 为空 + DB 已有较多记录） */}
      <AlertDialog open={emptyPublishConfirmOpen} onOpenChange={setEmptyPublishConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认清空 {year} 年所有节假日？</AlertDialogTitle>
            <AlertDialogDescription>
              当前 {year} 年已发布 {yearQuery.data?.items.length ?? 0} 条节假日记录。
              发布空内容会**全部删除**它们。此操作不可撤销，请确认无误。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                setEmptyPublishConfirmOpen(false);
                await doPublish(true);
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              确认清空
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function Legend() {
  return (
    <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
      <LegendItem className="bg-destructive/10 ring-1 ring-destructive/30" label="法定节假日" />
      <LegendItem className="bg-primary/10 ring-1 ring-primary/30" label="调休补班" />
      <LegendItem className="bg-muted/60" label="周末（默认休）" />
    </div>
  );
}

function LegendItem({ className, label }: { className: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`inline-block h-3 w-3 rounded ${className}`} />
      {label}
    </span>
  );
}

function StatPill({
  label,
  value,
  highlight,
}: {
  label: string;
  value: number;
  highlight?: boolean;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 ${
        highlight ? 'border-orange-500/50 bg-orange-500/5' : 'bg-card'
      }`}
    >
      <span className="text-muted-foreground">{label}</span>
      <span className="font-semibold">{value}</span>
    </span>
  );
}

/**
 * 统计整年的工作日 / 休息日数量（基于 draft：HOLIDAY=休、WORKDAY=班、其它按周末规则）
 */
function computeStats(
  year: number,
  draft: HolidayDraftMap
): { workDays: number; restDays: number } {
  let workDays = 0;
  let restDays = 0;
  const isLeap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  const totalDays = isLeap ? 366 : 365;
  for (let i = 0; i < totalDays; i += 1) {
    const d = new Date(year, 0, 1 + i);
    const item = draft.get(toIso(d));
    if (item?.type === 'HOLIDAY') {
      restDays += 1;
    } else if (item?.type === 'WORKDAY') {
      workDays += 1;
    } else if (isWeekend(d)) {
      restDays += 1;
    } else {
      workDays += 1;
    }
  }
  return { workDays, restDays };
}
