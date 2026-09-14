import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { toast } from 'sonner';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { invalidateAnalyticsQueries } from '@/hooks/analytics-invalidation';
import { useAuthStore } from '@/stores/auth';

import { useMyEffort } from './use-my-effort';

const mocks = vi.hoisted(() => ({
  apiGet: vi.fn(),
  apiPut: vi.fn(),
  apiPost: vi.fn(),
  apiDelete: vi.fn(),
}));

vi.mock('@/lib/api', () => ({
  api: { get: mocks.apiGet, put: mocks.apiPut, post: mocks.apiPost, delete: mocks.apiDelete },
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock('@/hooks/analytics-invalidation', () => ({
  invalidateAnalyticsQueries: vi.fn(async () => undefined),
}));

function fmt(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate()
  ).padStart(2, '0')}`;
}

const today = fmt(new Date());

function record(id: string, workDate: string, recordType: 'ACTUAL' | 'PLAN', version?: number) {
  return {
    id,
    projectId: 'project-1',
    actualTime: '2',
    workType: null,
    description: '既有描述',
    recordType,
    workDate,
    startDate: workDate,
    endDate: workDate,
    version,
    project: { name: '项目一', customerName: '客户一' },
  };
}

function setupApi(actualVersion: number | undefined, planVersion: number | undefined) {
  mocks.apiGet.mockImplementation(
    async (url: string, config?: { params?: { recordType?: string; startDate?: string } }) => {
      if (url === '/holidays/work-dates') return { data: { restDates: [], workDates: [] } };
      if (url === '/effort-records/my/timesheet') {
        if (config?.params?.recordType === 'PLAN') {
          // 计划按「下一个工作日」分组；用查询起始日（本周首个计划目标日）作为键即可命中。
          const planDate = config.params.startDate ?? today;
          return { data: { [planDate]: [record('plan-1', planDate, 'PLAN', planVersion)] } };
        }
        return {
          data: {
            [today]: [
              record('actual-1', today, 'ACTUAL', actualVersion),
              record('actual-2', today, 'ACTUAL', actualVersion),
            ],
          },
        };
      }
      throw new Error(`未预期的请求 ${url}`);
    }
  );
}

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

function loadedPlanDate(planDayEfforts: Map<string, { records: unknown[] }>): string | undefined {
  return [...planDayEfforts.entries()].find(([, day]) => day.records.length === 1)?.[0];
}

async function renderReady() {
  const hook = renderHook(() => useMyEffort(), { wrapper });
  await waitFor(() => expect(hook.result.current.dayEfforts.get(today)?.records.length).toBe(2));
  await waitFor(() => expect(loadedPlanDate(hook.result.current.planDayEfforts)).toBeTruthy());
  const planDate = loadedPlanDate(hook.result.current.planDayEfforts)!;
  return { ...hook, planDate };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.apiPut.mockResolvedValue({ data: {} });
  mocks.apiPost.mockResolvedValue({ data: {} });
  mocks.apiDelete.mockResolvedValue({ data: {} });
  useAuthStore.setState({ user: { employee: { id: 'emp-1' } } as never });
});

describe('useMyEffort 保存工时', () => {
  it('服务端记录缺少 version 时拒绝保存并要求刷新', async () => {
    setupApi(undefined, undefined);
    const { result } = await renderReady();
    act(() => result.current.updateRow(today, 'actual-1', 'description', '改一下'));
    await act(async () => result.current.save(today));

    expect(toast.error).toHaveBeenCalledWith('工时数据版本缺失，请刷新后重试');
    expect(mocks.apiPut).not.toHaveBeenCalled();
    expect(mocks.apiDelete).not.toHaveBeenCalled();
  });

  it('删除与修改都携带 version，成功后刷新分析缓存', async () => {
    setupApi(3, 1);
    const { result } = await renderReady();
    act(() => result.current.removeRow(today, 'actual-1'));
    act(() => result.current.updateRow(today, 'actual-2', 'description', '新的描述'));
    await act(async () => result.current.save(today));

    expect(mocks.apiDelete).toHaveBeenCalledWith('/effort-records/actual-1', {
      params: { version: 3 },
    });
    expect(mocks.apiPut).toHaveBeenCalledWith(
      '/effort-records/actual-2',
      expect.objectContaining({ description: '新的描述', version: 3 })
    );
    expect(toast.success).toHaveBeenCalledWith('保存成功');
    expect(invalidateAnalyticsQueries).toHaveBeenCalledWith(expect.anything(), '/effort-records');
    expect(result.current.hasUnsavedChanges(today)).toBe(false);
  });

  it('保存失败时提示重试并重新同步服务端数据', async () => {
    setupApi(3, 1);
    mocks.apiPut.mockRejectedValueOnce(new Error('boom'));
    const { result } = await renderReady();
    act(() => result.current.updateRow(today, 'actual-2', 'description', '新的描述'));
    await act(async () => result.current.save(today));

    expect(toast.error).toHaveBeenCalledWith('保存失败，请重试');
    expect(invalidateAnalyticsQueries).toHaveBeenCalledWith(expect.anything(), '/effort-records');
    expect(result.current.hasUnsavedChanges(today)).toBe(false);
  });
});

describe('useMyEffort 保存计划', () => {
  it('计划记录缺少 version 时拒绝保存', async () => {
    setupApi(3, undefined);
    const { result, planDate } = await renderReady();
    act(() => result.current.updatePlanRow(planDate, 'plan-1', 'description', '改计划'));
    await act(async () => result.current.savePlan(planDate));

    expect(toast.error).toHaveBeenCalledWith('工时数据版本缺失，请刷新后重试');
    expect(mocks.apiPut).not.toHaveBeenCalled();
  });

  it('计划删除与修改携带 version，成功后刷新分析缓存', async () => {
    setupApi(3, 5);
    const { result, planDate } = await renderReady();
    act(() => result.current.updatePlanRow(planDate, 'plan-1', 'description', '新的计划'));
    await act(async () => result.current.savePlan(planDate));

    expect(mocks.apiPut).toHaveBeenCalledWith(
      '/effort-records/plan-1',
      expect.objectContaining({ recordType: 'PLAN', version: 5 })
    );
    expect(toast.success).toHaveBeenCalledWith('计划保存成功');
    expect(invalidateAnalyticsQueries).toHaveBeenCalledWith(expect.anything(), '/effort-records');
  });

  it('计划保存失败时提示并回滚本地编辑', async () => {
    setupApi(3, 5);
    mocks.apiDelete.mockRejectedValueOnce(new Error('boom'));
    const { result, planDate } = await renderReady();
    act(() => result.current.removePlanRow(planDate, 'plan-1'));
    await act(async () => result.current.savePlan(planDate));

    expect(mocks.apiDelete).toHaveBeenCalledWith('/effort-records/plan-1', {
      params: { version: 5 },
    });
    expect(toast.error).toHaveBeenCalledWith('计划保存失败，请重试');
    expect(result.current.hasPlanUnsavedChanges(planDate)).toBe(false);
  });
});
