import type { IEffortRecordResponse } from '@ky-azeroth/shared/types/effort-record';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo, useState } from 'react';
import { toast } from 'sonner';

import { invalidateAnalyticsQueries } from '@/hooks/analytics-invalidation';
import { api } from '@/lib/api';
import { useAuthStore } from '@/stores/auth';

import {
  createEmptyEffortRow,
  type DayEffort,
  type DayPlanEffort,
  type EffortRowData,
  getDayStatus,
  getNextWorkDate,
} from '../types';

// ──── helpers ─────────────────────────────────

function startOfWeek(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay(); // 0=Sun
  const diff = day === 0 ? -6 : 1 - day; // Mon as start
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function endOfWeek(date: Date): Date {
  const d = startOfWeek(date);
  d.setDate(d.getDate() + 6);
  return d;
}

function formatDate(d: Date): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getWeekDates(weekStart: Date): string[] {
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + i);
    return formatDate(d);
  });
}

function responseToRow(record: IEffortRecordResponse): EffortRowData {
  return {
    id: record.id,
    tempId: record.id, // 使用服务端 ID 作为稳定标识，避免 refetch 后 key 不稳定
    projectId: record.projectId,
    projectName: record.project?.name ?? undefined,
    customerName: record.project?.customerName ?? undefined,
    actualTime: Number(record.actualTime),
    workType: record.workType ?? null,
    description: record.description ?? '',
    recordType: record.recordType ?? 'ACTUAL',
    version: record.version,
    _status: 'unchanged',
  };
}

// ──── hook ─────────────────────────────────

/**
 * 「我的填报」hook：固定按当前登录用户查询/保存工时。
 *
 * 历史上曾支持 admin 切换 ownerId 查看他人填报，已移除——admin 要看/管别人
 * 的工时请走「全部记录」Tab。该 Tab 语义=字面意义的「我的」。
 */
export function useMyEffort() {
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const ownerId = user?.employee?.id ?? '';

  // Week navigation
  const [weekOffset, setWeekOffset] = useState(0);
  const [selectedDate, setSelectedDate] = useState<string>(formatDate(new Date()));

  // ──── local edit state (layered on top of server data) ────
  const [localEdits, setLocalEdits] = useState<Map<string, EffortRowData[]>>(new Map());
  const [planLocalEdits, setPlanLocalEdits] = useState<Map<string, EffortRowData[]>>(new Map());

  const baseDate = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() + weekOffset * 7);
    return d;
  }, [weekOffset]);

  const weekStart = useMemo(() => startOfWeek(baseDate), [baseDate]);
  const weekEnd = useMemo(() => endOfWeek(baseDate), [baseDate]);
  const weekDates = useMemo(() => getWeekDates(weekStart), [weekStart]);

  const weekStartStr = formatDate(weekStart);
  const weekEndStr = formatDate(weekEnd);

  // ──── fetch work calendar (覆盖本周 + 后续 30 天，足以跨春节等连续休假) ────
  // restDatesSet 由后端 holidays 配置 + 周末规则综合而成，是「明日计划顺延」的唯一真相源。
  // 首次加载完成前 restDatesSet 为空，getNextWorkDate 会降级到「仅跳周末」，
  // 加载完成后 useMemo 重新计算自动修正。
  const calendarRange = useMemo(() => {
    const end = new Date(weekEnd);
    end.setDate(end.getDate() + 30);
    return { startDate: weekStartStr, endDate: formatDate(end) };
  }, [weekStartStr, weekEnd]);

  const { data: workCalendar } = useQuery({
    queryKey: ['holidays-work-dates', calendarRange.startDate, calendarRange.endDate],
    queryFn: async () => {
      const response = await api.get('/holidays/work-dates', {
        params: { startDate: calendarRange.startDate, endDate: calendarRange.endDate },
      });
      return response.data as { restDates: string[]; workDates: string[] };
    },
    staleTime: 10 * 60 * 1000, // 10min，节假日配置极少变动
  });

  const restDatesSet = useMemo(
    () => new Set(workCalendar?.restDates ?? []),
    [workCalendar?.restDates]
  );

  // Plan date range: covers next work day of each weekday (Tue to next Mon).
  // 节假日/周末顺延，由 restDatesSet 提供真相；未加载时降级仅跳周末。
  const planStartStr = useMemo(
    () => getNextWorkDate(weekStartStr, restDatesSet),
    [weekStartStr, restDatesSet]
  );
  const planEndStr = useMemo(
    () => getNextWorkDate(weekEndStr, restDatesSet),
    [weekEndStr, restDatesSet]
  );

  // ──── fetch ACTUAL week data ────
  // 使用 /effort-records/my/timesheet 专用接口：后端强制用 user.employeeId ?? user.id
  // 过滤，前端完全不需要传 ownerId。避免前端 ownerId 计算错误导致的越权数据暴露。
  const queryKey = useMemo(
    () => ['my-effort', weekStartStr, weekEndStr],
    [weekStartStr, weekEndStr]
  );

  const {
    data: rawRecords = [],
    isLoading,
    isError,
    refetch,
  } = useQuery({
    queryKey,
    queryFn: async () => {
      const response = await api.get('/effort-records/my/timesheet', {
        params: {
          startDate: weekStartStr,
          endDate: weekEndStr,
          recordType: 'ACTUAL',
        },
      });
      // /my/timesheet 返回 Record<date, records[]>，拍平成数组供后续聚合
      const byDate = (response.data ?? {}) as Record<string, IEffortRecordResponse[]>;
      return Object.values(byDate).flat();
    },
    staleTime: 30 * 1000,
  });

  // ──── fetch PLAN data ────
  const planQueryKey = useMemo(
    () => ['my-effort-plan', planStartStr, planEndStr],
    [planStartStr, planEndStr]
  );

  const { data: rawPlanRecords = [] } = useQuery({
    queryKey: planQueryKey,
    queryFn: async () => {
      const response = await api.get('/effort-records/my/timesheet', {
        params: {
          startDate: planStartStr,
          endDate: planEndStr,
          recordType: 'PLAN',
        },
      });
      const byDate = (response.data ?? {}) as Record<string, IEffortRecordResponse[]>;
      return Object.values(byDate).flat();
    },
    staleTime: 30 * 1000,
  });

  // ──── Build ACTUAL day efforts for the week ────
  const dayEfforts = useMemo((): Map<string, DayEffort> => {
    // Group raw records by workDate or startDate
    const serverByDate = new Map<string, EffortRowData[]>();
    for (const rec of rawRecords) {
      const date = rec.workDate ?? rec.startDate ?? '';
      const dateKey = date.slice(0, 10);
      if (!dateKey) continue;
      const arr = serverByDate.get(dateKey) ?? [];
      arr.push(responseToRow(rec));
      serverByDate.set(dateKey, arr);
    }

    const result = new Map<string, DayEffort>();
    for (const date of weekDates) {
      const rows = localEdits.has(date) ? localEdits.get(date)! : (serverByDate.get(date) ?? []);
      const activeRows = rows.filter((r) => r._status !== 'deleted');
      const totalHours = activeRows.reduce((sum, r) => sum + (r.actualTime || 0), 0);
      result.set(date, {
        date,
        records: rows,
        totalHours,
        status: getDayStatus(totalHours),
      });
    }
    return result;
  }, [rawRecords, localEdits, weekDates]);

  // ──── Build PLAN day efforts (keyed by targetDate = workDate of PLAN records) ────
  const planDayEfforts = useMemo((): Map<string, DayPlanEffort> => {
    const serverByDate = new Map<string, EffortRowData[]>();
    for (const rec of rawPlanRecords) {
      const date = rec.workDate ?? '';
      const dateKey = date.slice(0, 10);
      if (!dateKey) continue;
      const arr = serverByDate.get(dateKey) ?? [];
      arr.push(responseToRow(rec));
      serverByDate.set(dateKey, arr);
    }

    const result = new Map<string, DayPlanEffort>();
    // For each weekday, the plan targets the next work day（节假日/周末顺延）
    for (const date of weekDates) {
      const targetDate = getNextWorkDate(date, restDatesSet);
      const rows = planLocalEdits.has(targetDate)
        ? planLocalEdits.get(targetDate)!
        : (serverByDate.get(targetDate) ?? []);
      const activeRows = rows.filter((r) => r._status !== 'deleted');
      const totalPlannedHours = activeRows.reduce((sum, r) => sum + (r.actualTime || 0), 0);
      result.set(targetDate, {
        targetDate,
        records: rows,
        totalPlannedHours,
      });
    }
    return result;
  }, [rawPlanRecords, planLocalEdits, weekDates, restDatesSet]);

  // Current day effort
  const currentDayEffort = useMemo(
    () =>
      dayEfforts.get(selectedDate) ?? {
        date: selectedDate,
        records: [],
        totalHours: 0,
        status: 'empty' as const,
      },
    [dayEfforts, selectedDate]
  );

  // Current day plan effort (plan for next work day，节假日/周末顺延)
  const nextDate = useMemo(
    () => getNextWorkDate(selectedDate, restDatesSet),
    [selectedDate, restDatesSet]
  );
  const currentDayPlanEffort = useMemo(
    (): DayPlanEffort =>
      planDayEfforts.get(nextDate) ?? {
        targetDate: nextDate,
        records: [],
        totalPlannedHours: 0,
      },
    [planDayEfforts, nextDate]
  );

  // ──── ACTUAL edit operations ────

  const ensureLocalEdits = useCallback(
    (date: string): EffortRowData[] => {
      if (localEdits.has(date)) return [...localEdits.get(date)!];
      // Copy from server snapshot
      const dayEffort = dayEfforts.get(date);
      return dayEffort ? [...dayEffort.records] : [];
    },
    [localEdits, dayEfforts]
  );

  const updateLocalEdits = useCallback((date: string, rows: EffortRowData[]) => {
    setLocalEdits((prev) => {
      const next = new Map(prev);
      next.set(date, rows);
      return next;
    });
  }, []);

  const addRow = useCallback(
    (date: string) => {
      const rows = ensureLocalEdits(date);
      rows.push(createEmptyEffortRow());
      updateLocalEdits(date, rows);
    },
    [ensureLocalEdits, updateLocalEdits]
  );

  const removeRow = useCallback(
    (date: string, tempId: string) => {
      const rows = ensureLocalEdits(date);
      const idx = rows.findIndex((r) => r.tempId === tempId);
      if (idx === -1) return;
      const row = rows[idx]!;
      if (row.id) {
        // Existing record: mark deleted
        rows[idx] = { ...row, _status: 'deleted' };
      } else {
        // New row: just remove
        rows.splice(idx, 1);
      }
      updateLocalEdits(date, rows);
    },
    [ensureLocalEdits, updateLocalEdits]
  );

  const updateRowPatch = useCallback(
    (date: string, tempId: string, patch: Partial<EffortRowData>) => {
      const rows = ensureLocalEdits(date);
      const idx = rows.findIndex((r) => r.tempId === tempId);
      if (idx === -1) return;
      const row = rows[idx]!;
      const newStatus = row._status === 'unchanged' ? 'modified' : row._status;
      rows[idx] = { ...row, ...patch, _status: newStatus } as EffortRowData;
      updateLocalEdits(date, rows);
    },
    [ensureLocalEdits, updateLocalEdits]
  );

  const updateRow = useCallback(
    (date: string, tempId: string, field: keyof EffortRowData, value: string | number | null) => {
      updateRowPatch(date, tempId, { [field]: value } as Partial<EffortRowData>);
    },
    [updateRowPatch]
  );

  const copyYesterday = useCallback(
    (date: string) => {
      const d = new Date(date + 'T00:00:00');
      d.setDate(d.getDate() - 1);
      const yesterdayStr = formatDate(d);
      const yesterdayEffort = dayEfforts.get(yesterdayStr);
      if (!yesterdayEffort || yesterdayEffort.records.length === 0) {
        toast.info('昨日无工时记录可复制');
        return;
      }

      const existingRows = ensureLocalEdits(date);
      const copiedRows: EffortRowData[] = yesterdayEffort.records
        .filter((r) => r._status !== 'deleted')
        .map((r) => ({
          tempId: crypto.randomUUID(),
          projectId: r.projectId,
          projectName: r.projectName,
          customerName: r.customerName,
          actualTime: 0,
          workType: r.workType,
          description: '',
          _status: 'new' as const,
        }));

      updateLocalEdits(date, [...existingRows, ...copiedRows]);
      toast.success(`已复制 ${copiedRows.length} 个项目`);
    },
    [dayEfforts, ensureLocalEdits, updateLocalEdits]
  );

  // ──── Apply yesterday's plan ────

  const applyYesterdayPlan = useCallback(
    (date: string) => {
      // Plans for today were created yesterday with workDate = date
      const planForToday = planDayEfforts.get(date);
      if (
        !planForToday ||
        planForToday.records.filter((r) => r._status !== 'deleted').length === 0
      ) {
        toast.info('昨日无工作计划可应用');
        return;
      }

      const existingRows = ensureLocalEdits(date);
      const appliedRows: EffortRowData[] = planForToday.records
        .filter((r) => r._status !== 'deleted')
        .map((r) => ({
          tempId: crypto.randomUUID(),
          projectId: r.projectId,
          projectName: r.projectName,
          customerName: r.customerName,
          actualTime: r.actualTime,
          workType: r.workType,
          description: r.description,
          _status: 'new' as const,
        }));

      updateLocalEdits(date, [...existingRows, ...appliedRows]);
      toast.success(`已应用 ${appliedRows.length} 条计划`);
    },
    [planDayEfforts, ensureLocalEdits, updateLocalEdits]
  );

  /** Whether the selected date has a plan to apply */
  const hasPlanForSelectedDate = useMemo(() => {
    const planForToday = planDayEfforts.get(selectedDate);
    return !!planForToday && planForToday.records.filter((r) => r._status !== 'deleted').length > 0;
  }, [planDayEfforts, selectedDate]);

  // ──── PLAN edit operations ────

  const ensurePlanLocalEdits = useCallback(
    (targetDate: string): EffortRowData[] => {
      if (planLocalEdits.has(targetDate)) return [...planLocalEdits.get(targetDate)!];
      const planEffort = planDayEfforts.get(targetDate);
      return planEffort ? [...planEffort.records] : [];
    },
    [planLocalEdits, planDayEfforts]
  );

  const updatePlanLocalEdits = useCallback((targetDate: string, rows: EffortRowData[]) => {
    setPlanLocalEdits((prev) => {
      const next = new Map(prev);
      next.set(targetDate, rows);
      return next;
    });
  }, []);

  const addPlanRow = useCallback(
    (targetDate: string) => {
      const rows = ensurePlanLocalEdits(targetDate);
      rows.push(createEmptyEffortRow());
      updatePlanLocalEdits(targetDate, rows);
    },
    [ensurePlanLocalEdits, updatePlanLocalEdits]
  );

  const removePlanRow = useCallback(
    (targetDate: string, tempId: string) => {
      const rows = ensurePlanLocalEdits(targetDate);
      const idx = rows.findIndex((r) => r.tempId === tempId);
      if (idx === -1) return;
      const row = rows[idx]!;
      if (row.id) {
        rows[idx] = { ...row, _status: 'deleted' };
      } else {
        rows.splice(idx, 1);
      }
      updatePlanLocalEdits(targetDate, rows);
    },
    [ensurePlanLocalEdits, updatePlanLocalEdits]
  );

  const updatePlanRowPatch = useCallback(
    (targetDate: string, tempId: string, patch: Partial<EffortRowData>) => {
      const rows = ensurePlanLocalEdits(targetDate);
      const idx = rows.findIndex((r) => r.tempId === tempId);
      if (idx === -1) return;
      const row = rows[idx]!;
      const newStatus = row._status === 'unchanged' ? 'modified' : row._status;
      rows[idx] = { ...row, ...patch, _status: newStatus } as EffortRowData;
      updatePlanLocalEdits(targetDate, rows);
    },
    [ensurePlanLocalEdits, updatePlanLocalEdits]
  );

  const updatePlanRow = useCallback(
    (
      targetDate: string,
      tempId: string,
      field: keyof EffortRowData,
      value: string | number | null
    ) => {
      updatePlanRowPatch(targetDate, tempId, { [field]: value } as Partial<EffortRowData>);
    },
    [updatePlanRowPatch]
  );

  // ──── save ACTUAL ────

  const [saving, setSaving] = useState(false);

  const save = useCallback(
    async (date: string) => {
      const rows = localEdits.get(date);
      if (!rows) {
        toast.info('没有需要保存的变更');
        return;
      }

      const deletedRows = rows.filter((r) => r._status === 'deleted' && r.id);
      const modifiedRows = rows.filter((r) => r._status === 'modified' && r.id);
      const newRows = rows.filter((r) => r._status === 'new' && r.projectId && r.actualTime > 0);

      if (deletedRows.length === 0 && modifiedRows.length === 0 && newRows.length === 0) {
        toast.info('没有需要保存的变更');
        return;
      }

      // Validate description is not empty for new and modified rows
      const rowsMissingDesc = [...modifiedRows, ...newRows].filter((r) => !r.description?.trim());
      if (rowsMissingDesc.length > 0) {
        toast.error('请填写工作描述后再保存');
        return;
      }

      if (
        [...deletedRows, ...modifiedRows].some(
          (row) => !Number.isInteger(row.version) || (row.version ?? 0) < 1
        )
      ) {
        toast.error('工时数据版本缺失，请刷新后重试');
        await queryClient.invalidateQueries({ queryKey });
        return;
      }

      setSaving(true);
      try {
        // 1. Delete
        for (const row of deletedRows) {
          await api.delete(`/effort-records/${row.id}`, { params: { version: row.version } });
        }

        // 2. Update modified
        for (const row of modifiedRows) {
          await api.put(`/effort-records/${row.id}`, {
            projectId: row.projectId,
            actualTime: String(row.actualTime),
            workType: row.workType ?? null,
            description: row.description || '',
            workDate: date,
            startDate: date,
            endDate: date,
            ownerId: ownerId || null,
            version: row.version,
          });
        }

        // 3. Batch create new
        if (newRows.length > 0) {
          await api.post('/effort-records/batch', {
            items: newRows.map((row) => ({
              projectId: row.projectId,
              actualTime: String(row.actualTime),
              workType: row.workType ?? null,
              description: row.description || '',
              workDate: date,
              startDate: date,
              endDate: date,
              recordType: 'ACTUAL',
              ownerId: ownerId || null,
            })),
          });
        }

        toast.success('保存成功');

        // Clear local edits for this date and refetch
        setLocalEdits((prev) => {
          const next = new Map(prev);
          next.delete(date);
          return next;
        });
        await Promise.all([
          queryClient.invalidateQueries({ queryKey }),
          queryClient.invalidateQueries({ queryKey: ['effort-records'] }),
          invalidateAnalyticsQueries(queryClient, '/effort-records'),
        ]);
      } catch {
        toast.error('保存失败，请重试');
        // 部分操作可能已成功，本地状态已不可信，清空该日期的 localEdits 并从服务端重新同步
        setLocalEdits((prev) => {
          const next = new Map(prev);
          next.delete(date);
          return next;
        });
        await Promise.all([
          queryClient.invalidateQueries({ queryKey }),
          queryClient.invalidateQueries({ queryKey: ['effort-records'] }),
          invalidateAnalyticsQueries(queryClient, '/effort-records'),
        ]);
      } finally {
        setSaving(false);
      }
    },
    [localEdits, ownerId, queryClient, queryKey]
  );

  // ──── save PLAN ────

  const [savingPlan, setSavingPlan] = useState(false);

  const savePlan = useCallback(
    async (targetDate: string) => {
      const rows = planLocalEdits.get(targetDate);
      if (!rows) {
        toast.info('没有需要保存的变更');
        return;
      }

      const deletedRows = rows.filter((r) => r._status === 'deleted' && r.id);
      const modifiedRows = rows.filter((r) => r._status === 'modified' && r.id);
      const newRows = rows.filter((r) => r._status === 'new' && r.projectId && r.actualTime > 0);

      if (deletedRows.length === 0 && modifiedRows.length === 0 && newRows.length === 0) {
        toast.info('没有需要保存的变更');
        return;
      }

      // Validate description is not empty for new and modified rows
      const rowsMissingDesc = [...modifiedRows, ...newRows].filter((r) => !r.description?.trim());
      if (rowsMissingDesc.length > 0) {
        toast.error('请填写计划内容后再保存');
        return;
      }

      if (
        [...deletedRows, ...modifiedRows].some(
          (row) => !Number.isInteger(row.version) || (row.version ?? 0) < 1
        )
      ) {
        toast.error('工时数据版本缺失，请刷新后重试');
        await queryClient.invalidateQueries({ queryKey: planQueryKey });
        return;
      }

      setSavingPlan(true);
      try {
        // 1. Delete
        for (const row of deletedRows) {
          await api.delete(`/effort-records/${row.id}`, { params: { version: row.version } });
        }

        // 2. Update modified
        for (const row of modifiedRows) {
          await api.put(`/effort-records/${row.id}`, {
            projectId: row.projectId,
            actualTime: String(row.actualTime),
            workType: row.workType ?? null,
            description: row.description || '',
            workDate: targetDate,
            startDate: targetDate,
            endDate: targetDate,
            recordType: 'PLAN',
            ownerId: ownerId || null,
            version: row.version,
          });
        }

        // 3. Batch create new
        if (newRows.length > 0) {
          await api.post('/effort-records/batch', {
            items: newRows.map((row) => ({
              projectId: row.projectId,
              actualTime: String(row.actualTime),
              workType: row.workType ?? null,
              description: row.description || '',
              workDate: targetDate,
              startDate: targetDate,
              endDate: targetDate,
              recordType: 'PLAN',
              ownerId: ownerId || null,
            })),
          });
        }

        toast.success('计划保存成功');

        // Clear plan local edits for this date and refetch
        setPlanLocalEdits((prev) => {
          const next = new Map(prev);
          next.delete(targetDate);
          return next;
        });
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: planQueryKey }),
          queryClient.invalidateQueries({ queryKey: ['effort-records'] }),
          invalidateAnalyticsQueries(queryClient, '/effort-records'),
        ]);
      } catch {
        toast.error('计划保存失败，请重试');
        setPlanLocalEdits((prev) => {
          const next = new Map(prev);
          next.delete(targetDate);
          return next;
        });
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: planQueryKey }),
          queryClient.invalidateQueries({ queryKey: ['effort-records'] }),
          invalidateAnalyticsQueries(queryClient, '/effort-records'),
        ]);
      } finally {
        setSavingPlan(false);
      }
    },
    [planLocalEdits, ownerId, queryClient, planQueryKey]
  );

  // ──── week navigation ────

  const goToPrevWeek = useCallback(() => {
    setWeekOffset((prev) => prev - 1);
    setSelectedDate((prev) => {
      const d = new Date(prev + 'T00:00:00');
      d.setDate(d.getDate() - 7);
      return formatDate(d);
    });
    setLocalEdits(new Map());
    setPlanLocalEdits(new Map());
  }, []);

  const goToNextWeek = useCallback(() => {
    setWeekOffset((prev) => prev + 1);
    setSelectedDate((prev) => {
      const d = new Date(prev + 'T00:00:00');
      d.setDate(d.getDate() + 7);
      return formatDate(d);
    });
    setLocalEdits(new Map());
    setPlanLocalEdits(new Map());
  }, []);

  const goToCurrentWeek = useCallback(() => {
    setWeekOffset(0);
    setSelectedDate(formatDate(new Date()));
    setLocalEdits(new Map());
    setPlanLocalEdits(new Map());
  }, []);

  // Check if there are unsaved changes for a specific date
  const hasUnsavedChanges = useCallback(
    (date: string) => {
      const rows = localEdits.get(date);
      if (!rows) return false;
      return rows.some((r) => r._status !== 'unchanged');
    },
    [localEdits]
  );

  // Check if there are any unsaved changes across all dates
  const hasAnyUnsavedChanges = useCallback(() => {
    for (const [, rows] of localEdits) {
      if (rows.some((r) => r._status !== 'unchanged')) return true;
    }
    return false;
  }, [localEdits]);

  // Check if there are unsaved plan changes for a specific target date
  const hasPlanUnsavedChanges = useCallback(
    (targetDate: string) => {
      const rows = planLocalEdits.get(targetDate);
      if (!rows) return false;
      return rows.some((r) => r._status !== 'unchanged');
    },
    [planLocalEdits]
  );

  // Check if there are any unsaved plan changes across all dates
  const hasAnyPlanUnsavedChanges = useCallback(() => {
    for (const [, rows] of planLocalEdits) {
      if (rows.some((r) => r._status !== 'unchanged')) return true;
    }
    return false;
  }, [planLocalEdits]);

  return {
    // Week state
    weekDates,
    weekStartStr,
    weekEndStr,
    weekOffset,
    selectedDate,
    setSelectedDate,

    // ACTUAL data
    dayEfforts,
    currentDayEffort,
    isLoading,
    isError,
    refetch,

    // ACTUAL edit operations
    addRow,
    removeRow,
    updateRow,
    updateRowPatch,
    copyYesterday,

    // ACTUAL save
    save,
    saving,
    hasUnsavedChanges,
    hasAnyUnsavedChanges,

    // PLAN data
    planDayEfforts,
    currentDayPlanEffort,
    nextDate,

    // PLAN edit operations
    addPlanRow,
    removePlanRow,
    updatePlanRow,
    updatePlanRowPatch,

    // PLAN save
    savePlan,
    savingPlan,
    hasPlanUnsavedChanges,
    hasAnyPlanUnsavedChanges,

    // Apply plan
    applyYesterdayPlan,
    hasPlanForSelectedDate,

    // Navigation
    goToPrevWeek,
    goToNextWeek,
    goToCurrentWeek,
  };
}
