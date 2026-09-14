import { act, renderHook, waitFor } from '@testing-library/react';
import { createElement, type PropsWithChildren, StrictMode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { api } from '@/lib/api';

import { useDrawerEntityDetail } from '../use-drawer-entity-detail';

interface PaymentEntity {
  id: string;
  name: string;
  amount: number;
  version: number;
}

interface PaymentForm {
  amount: number;
  version: number;
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
}

interface PendingRequest<T> {
  url: string;
  deferred: Deferred<T>;
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

const pendingGets: Array<PendingRequest<{ data: PaymentEntity }>> = [];
const pendingPuts: Array<PendingRequest<{ data: PaymentEntity }>> = [];
const pendingDeletes: Array<PendingRequest<{ data: null }>> = [];
const notifyEntityChanged = vi.fn();
const pop = vi.fn();
const drawerStack = { notifyEntityChanged, pop };
const setBeforeCloseGuard = vi.fn();
const toastError = vi.fn();
const toastSuccess = vi.fn();

vi.mock('sonner', () => ({
  toast: {
    error: (message: string) => toastError(message),
    success: (message: string) => toastSuccess(message),
  },
}));

vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api');
  return {
    ...actual,
    api: {
      get: vi.fn(),
      put: vi.fn(),
      delete: vi.fn(),
    },
  };
});

vi.mock('@/components/patterns/drawer-stack/context', () => ({
  useDrawerStack: () => drawerStack,
}));

vi.mock('@/components/patterns/drawer-stack/before-close-context', () => ({
  useSetBeforeCloseGuard: () => setBeforeCloseGuard,
}));

const schema = z.object({
  amount: z.number().positive('金额必须大于 0'),
  version: z.number().int(),
});
const toFormData = (entity: PaymentEntity): PaymentForm => ({
  amount: entity.amount,
  version: entity.version,
});
const toPayload = (form: PaymentForm) => form;

function strictWrapper({ children }: PropsWithChildren) {
  return createElement(StrictMode, null, children);
}

function renderDetail(id = 'A') {
  return renderHook(
    ({ entityId }: { entityId: string }) =>
      useDrawerEntityDetail<PaymentEntity, PaymentForm>({
        endpoint: '/payments',
        id: entityId,
        entityType: 'payment',
        schema,
        toFormData,
        toPayload,
        entityNameOf: (entity) => entity.name,
      }),
    { initialProps: { entityId: id }, wrapper: strictWrapper }
  );
}

function getRequests(url: string) {
  return pendingGets.filter((request) => request.url === url);
}

async function resolveGets(
  requests: Array<PendingRequest<{ data: PaymentEntity }>>,
  data: PaymentEntity
) {
  await act(async () => {
    for (const request of requests) request.deferred.resolve({ data });
    await Promise.resolve();
  });
}

async function loadEntity(
  result: { current: ReturnType<typeof useDrawerEntityDetail<PaymentEntity, PaymentForm>> },
  entity: PaymentEntity
) {
  const url = `/payments/${entity.id}`;
  await waitFor(() => expect(getRequests(url).length).toBeGreaterThan(0));
  await resolveGets(getRequests(url), entity);
  await waitFor(() => expect(result.current.data).toEqual(entity));
  await waitFor(() => expect(result.current.formData).toEqual(toFormData(entity)));
}

describe('useDrawerEntityDetail identity/generation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    pendingGets.length = 0;
    pendingPuts.length = 0;
    pendingDeletes.length = 0;

    vi.mocked(api.get).mockImplementation((url) => {
      const request: PendingRequest<{ data: PaymentEntity }> = {
        url: String(url),
        deferred: createDeferred<{ data: PaymentEntity }>(),
      };
      pendingGets.push(request);
      return request.deferred.promise as never;
    });
    vi.mocked(api.put).mockImplementation((url) => {
      const request: PendingRequest<{ data: PaymentEntity }> = {
        url: String(url),
        deferred: createDeferred<{ data: PaymentEntity }>(),
      };
      pendingPuts.push(request);
      return request.deferred.promise as never;
    });
    vi.mocked(api.delete).mockImplementation((url) => {
      const request: PendingRequest<{ data: null }> = {
        url: String(url),
        deferred: createDeferred<{ data: null }>(),
      };
      pendingDeletes.push(request);
      return request.deferred.promise as never;
    });
  });

  it('编辑中的 A 切到 B 时同步重置表单、校验、dirty 和删除确认，A 的事件闭包失效', async () => {
    const entityA: PaymentEntity = { id: 'A', name: '实体 A', amount: 100, version: 1 };
    const entityB: PaymentEntity = { id: 'B', name: '实体 B', amount: 200, version: 4 };
    const { result, rerender } = renderDetail();
    await loadEntity(result, entityA);

    act(() => result.current.enterEditMode());
    act(() => result.current.updateFormField('amount', -1));
    await act(async () => result.current.handleSave());
    act(() => result.current.requestDelete());

    expect(result.current.mode).toBe('edit');
    expect(result.current.isDirty).toBe(true);
    expect(result.current.getFieldError('amount')).toBe('金额必须大于 0');
    expect(result.current.deleteConfirmProps.open).toBe(true);

    const staleUpdate = result.current.updateFormField;
    const staleDeleteRequest = result.current.requestDelete;
    rerender({ entityId: 'B' });

    expect(result.current.mode).toBe('view');
    expect(result.current.isDirty).toBe(false);
    expect(result.current.formData).toEqual({});
    expect(result.current.getFieldError('amount')).toBeUndefined();
    expect(result.current.deleteConfirmProps.open).toBe(false);

    act(() => {
      staleUpdate('amount', 999);
      staleDeleteRequest();
    });
    expect(result.current.formData).toEqual({});
    expect(result.current.deleteConfirmProps.open).toBe(false);

    await loadEntity(result, entityB);
    expect(result.current.mode).toBe('view');
    expect(result.current.formData).toEqual({ amount: 200, version: 4 });
  });

  it('A 的 PUT 在切到 B 后完成时，不得 toast、notify、refetch 或改写 B', async () => {
    const entityA: PaymentEntity = { id: 'A', name: '实体 A', amount: 100, version: 1 };
    const entityB: PaymentEntity = { id: 'B', name: '实体 B', amount: 200, version: 2 };
    const { result, rerender } = renderDetail();
    await loadEntity(result, entityA);

    act(() => result.current.enterEditMode());
    act(() => result.current.updateFormField('amount', 120));
    let savePromise!: Promise<void>;
    act(() => {
      savePromise = result.current.handleSave();
    });
    await waitFor(() => expect(pendingPuts).toHaveLength(1));
    const aGetCount = getRequests('/payments/A').length;

    rerender({ entityId: 'B' });
    await loadEntity(result, entityB);

    await act(async () => {
      pendingPuts[0]!.deferred.resolve({
        data: { ...entityA, amount: 120, version: 2 },
      });
      await savePromise;
    });

    expect(toastSuccess).not.toHaveBeenCalled();
    expect(notifyEntityChanged).not.toHaveBeenCalled();
    expect(getRequests('/payments/A')).toHaveLength(aGetCount);
    expect(result.current.data).toEqual(entityB);
    expect(result.current.formData).toEqual({ amount: 200, version: 2 });
    expect(result.current.saving).toBe(false);
  });

  it('保存先提交 PUT 最新 version，并拒绝保存前及保存后降版本 GET 覆盖', async () => {
    const entityA: PaymentEntity = { id: 'A', name: '实体 A', amount: 100, version: 2 };
    const savedA: PaymentEntity = { ...entityA, amount: 120, version: 3 };
    const staleA: PaymentEntity = { ...entityA, amount: 100, version: 2 };
    const { result } = renderDetail();
    await loadEntity(result, entityA);

    act(() => result.current.enterEditMode());
    act(() => result.current.updateFormField('amount', 120));

    const baselineGetCount = getRequests('/payments/A').length;
    let staleRefetchPromise!: Promise<void>;
    let savePromise!: Promise<void>;
    act(() => {
      staleRefetchPromise = result.current.refetch();
      savePromise = result.current.handleSave();
    });
    await waitFor(() => expect(getRequests('/payments/A')).toHaveLength(baselineGetCount + 1));
    await waitFor(() => expect(pendingPuts).toHaveLength(1));

    await act(async () => {
      pendingPuts[0]!.deferred.resolve({ data: savedA });
      await Promise.resolve();
    });
    await waitFor(() => expect(getRequests('/payments/A')).toHaveLength(baselineGetCount + 2));
    await waitFor(() => expect(result.current.data).toEqual(savedA));

    const preSaveGet = getRequests('/payments/A')[baselineGetCount]!;
    const postSaveGet = getRequests('/payments/A')[baselineGetCount + 1]!;
    await act(async () => {
      preSaveGet.deferred.resolve({ data: staleA });
      await staleRefetchPromise;
    });
    await act(async () => {
      postSaveGet.deferred.resolve({ data: staleA });
      await savePromise;
    });

    expect(api.put).toHaveBeenCalledWith('/payments/A', { amount: 120, version: 2 });
    expect(result.current.mode).toBe('view');
    expect(result.current.data).toEqual(savedA);
    expect(result.current.formData).toEqual({ amount: 120, version: 3 });
    expect(result.current.loading).toBe(false);
  });

  it('删除从当前实体读取严格正整数 version 并按 query 传递', async () => {
    const entityA: PaymentEntity = { id: 'A', name: '实体 A', amount: 100, version: 7 };
    const { result } = renderDetail();
    await loadEntity(result, entityA);

    act(() => result.current.requestDelete());
    let deletePromise!: Promise<void>;
    act(() => {
      deletePromise = result.current.deleteConfirmProps.onConfirm();
    });
    await waitFor(() => expect(pendingDeletes).toHaveLength(1));
    expect(api.delete).toHaveBeenCalledWith('/payments/A?version=7');

    await act(async () => {
      pendingDeletes[0]!.deferred.resolve({ data: null });
      await deletePromise;
    });
    expect(toastSuccess).toHaveBeenCalledWith('删除成功');
    expect(notifyEntityChanged).toHaveBeenCalledWith('payment');
    expect(pop).toHaveBeenCalledTimes(1);
  });

  it('A 的 DELETE 在切到 B 后完成时，不得关闭/弹出 B 或发送成功副作用', async () => {
    const entityA: PaymentEntity = { id: 'A', name: '实体 A', amount: 100, version: 1 };
    const entityB: PaymentEntity = { id: 'B', name: '实体 B', amount: 200, version: 2 };
    const { result, rerender } = renderDetail();
    await loadEntity(result, entityA);

    act(() => result.current.requestDelete());
    let deletePromise!: Promise<void>;
    act(() => {
      deletePromise = result.current.deleteConfirmProps.onConfirm();
    });
    await waitFor(() => expect(pendingDeletes).toHaveLength(1));

    rerender({ entityId: 'B' });
    await loadEntity(result, entityB);
    await act(async () => {
      pendingDeletes[0]!.deferred.resolve({ data: null });
      await deletePromise;
    });

    expect(toastSuccess).not.toHaveBeenCalled();
    expect(notifyEntityChanged).not.toHaveBeenCalled();
    expect(pop).not.toHaveBeenCalled();
    expect(result.current.data).toEqual(entityB);
    expect(result.current.deleteConfirmProps.open).toBe(false);
    expect(result.current.deleteConfirmProps.loading).toBe(false);
  });

  it('A 保存中卸载并重挂载 B 后，旧保存闭包与延迟 PUT 都无 API 或界面副作用', async () => {
    const entityA: PaymentEntity = { id: 'A', name: '实体 A', amount: 100, version: 1 };
    const entityB: PaymentEntity = { id: 'B', name: '实体 B', amount: 200, version: 2 };
    const firstMount = renderDetail();
    await loadEntity(firstMount.result, entityA);

    act(() => firstMount.result.current.enterEditMode());
    act(() => firstMount.result.current.updateFormField('amount', 120));
    const staleHandleSave = firstMount.result.current.handleSave;
    let savePromise!: Promise<void>;
    act(() => {
      savePromise = staleHandleSave();
    });
    await waitFor(() => expect(pendingPuts).toHaveLength(1));
    const aGetCount = getRequests('/payments/A').length;

    firstMount.unmount();
    const secondMount = renderDetail('B');
    await loadEntity(secondMount.result, entityB);

    await act(async () => staleHandleSave());
    expect(pendingPuts).toHaveLength(1);
    expect(getRequests('/payments/A')).toHaveLength(aGetCount);

    await act(async () => {
      pendingPuts[0]!.deferred.resolve({
        data: { ...entityA, amount: 120, version: 2 },
      });
      await savePromise;
    });

    expect(pendingPuts).toHaveLength(1);
    expect(getRequests('/payments/A')).toHaveLength(aGetCount);
    expect(toastSuccess).not.toHaveBeenCalled();
    expect(toastError).not.toHaveBeenCalled();
    expect(notifyEntityChanged).not.toHaveBeenCalled();
    expect(pop).not.toHaveBeenCalled();
    expect(secondMount.result.current.data).toEqual(entityB);
  });

  it('A 删除中卸载并重挂载 B 后，旧删除闭包与延迟 DELETE 都无 API 或界面副作用', async () => {
    const entityA: PaymentEntity = { id: 'A', name: '实体 A', amount: 100, version: 3 };
    const entityB: PaymentEntity = { id: 'B', name: '实体 B', amount: 200, version: 4 };
    const firstMount = renderDetail();
    await loadEntity(firstMount.result, entityA);

    act(() => firstMount.result.current.requestDelete());
    const staleDeleteConfirm = firstMount.result.current.deleteConfirmProps.onConfirm;
    let deletePromise!: Promise<void>;
    act(() => {
      deletePromise = staleDeleteConfirm();
    });
    await waitFor(() => expect(pendingDeletes).toHaveLength(1));

    firstMount.unmount();
    const secondMount = renderDetail('B');
    await loadEntity(secondMount.result, entityB);

    await act(async () => staleDeleteConfirm());
    expect(pendingDeletes).toHaveLength(1);

    await act(async () => {
      pendingDeletes[0]!.deferred.resolve({ data: null });
      await deletePromise;
    });

    expect(pendingDeletes).toHaveLength(1);
    expect(toastSuccess).not.toHaveBeenCalled();
    expect(toastError).not.toHaveBeenCalled();
    expect(notifyEntityChanged).not.toHaveBeenCalled();
    expect(pop).not.toHaveBeenCalled();
    expect(secondMount.result.current.data).toEqual(entityB);
  });

  it.each([
    ['缺失', undefined],
    ['零', 0],
    ['负数', -1],
    ['小数', 1.5],
    ['字符串', '2'],
  ])('version %s 时拒绝发送 DELETE 并给出明确错误', async (_label, invalidVersion) => {
    const invalidEntity = {
      id: 'A',
      name: '实体 A',
      amount: 100,
      version: invalidVersion,
    } as PaymentEntity;
    const { result } = renderDetail();
    await loadEntity(result, invalidEntity);

    act(() => result.current.requestDelete());
    await act(async () => result.current.deleteConfirmProps.onConfirm());

    expect(api.delete).not.toHaveBeenCalled();
    expect(result.current.deleteConfirmProps.loading).toBe(false);
    expect(toastError).toHaveBeenCalledWith('无法删除：当前实体缺少有效版本号，请刷新后重试');
  });
});
