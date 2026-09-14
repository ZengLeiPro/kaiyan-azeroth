import { act, render, renderHook, waitFor } from '@testing-library/react';
import {
  createElement,
  startTransition,
  StrictMode,
  Suspense,
  useLayoutEffect,
  useState,
} from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { api } from '@/lib/api';

import {
  useDrawerEntityDetail,
  type UseDrawerEntityDetailReturn,
} from '../use-drawer-entity-detail';

interface PaymentEntity {
  id: string;
  name: string;
  flowStatus: string;
  amount: number;
  version: number;
}

const entity: PaymentEntity = {
  id: 'payment-1',
  name: '回款记录',
  flowStatus: 'approved',
  amount: 100,
  version: 2,
};
let fetchedEntity: PaymentEntity = { ...entity };
let nextRefetchedEntity: PaymentEntity | null = null;
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

interface PaymentForm {
  amount: number;
  version: number;
}

const schema = z.object({
  amount: z.number().positive(),
  version: z.number().int(),
});
const toFormData = (data: PaymentEntity): PaymentForm => ({
  amount: data.amount,
  version: data.version,
});
const toPayload = (form: PaymentForm) => form;
const entityNameOf = (data: PaymentEntity) => data.name;

function renderDetail(customUpdate?: (args: unknown) => Promise<{ message?: string } | void>) {
  return renderHook(() =>
    useDrawerEntityDetail<PaymentEntity, PaymentForm>({
      endpoint: '/payments',
      id: entity.id,
      entityType: 'payment',
      schema,
      toFormData,
      toPayload,
      customUpdate,
      entityNameOf,
    })
  );
}

function renderWithUnstableMappers(
  mapperCall: (formOffset: number, version: number) => void,
  initialProps = { formOffset: 0, payloadOffset: 0 }
) {
  return renderHook(
    ({ formOffset, payloadOffset }: { formOffset: number; payloadOffset: number }) =>
      useDrawerEntityDetail<PaymentEntity, PaymentForm>({
        endpoint: '/payments',
        id: entity.id,
        entityType: 'payment',
        schema,
        // 故意保持为每次 render 都创建的新函数，复现 7 类真实调用点的形态。
        toFormData: (data) => {
          mapperCall(formOffset, data.version);
          return { amount: data.amount + formOffset, version: data.version };
        },
        toPayload: (form) => ({ ...form, amount: form.amount + payloadOffset }),
        entityNameOf: (data) => data.name,
      }),
    { initialProps }
  );
}

function renderWithUnstableCustomUpdate(
  customUpdateCall: (implementation: string, payload: unknown) => void
) {
  return renderHook(
    ({ implementation }: { implementation: string }) =>
      useDrawerEntityDetail<PaymentEntity, PaymentForm>({
        endpoint: '/payments',
        id: entity.id,
        entityType: 'payment',
        schema,
        toFormData: (data) => ({ amount: data.amount, version: data.version }),
        toPayload: (form) => form,
        customUpdate: async ({ payload }) => {
          customUpdateCall(implementation, payload);
          return { message: implementation };
        },
        entityNameOf: (data) => data.name,
      }),
    { initialProps: { implementation: '旧实现' } }
  );
}

describe('useDrawerEntityDetail', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchedEntity = { ...entity };
    nextRefetchedEntity = null;
    vi.mocked(api.get).mockImplementation(() => {
      if (nextRefetchedEntity) {
        fetchedEntity = nextRefetchedEntity;
        nextRefetchedEntity = null;
      }
      return Promise.resolve({ data: fetchedEntity }) as never;
    });
  });

  it('默认更新使用实体 PUT', async () => {
    vi.mocked(api.put).mockResolvedValueOnce({ data: entity });
    const { result } = renderDetail();

    await waitFor(() => expect(result.current.formData.amount).toBe(100));
    act(() => result.current.enterEditMode());
    act(() => result.current.updateFormField('amount', 120));
    await act(async () => result.current.handleSave());

    expect(api.put).toHaveBeenCalledWith('/payments/payment-1', { amount: 120, version: 2 });
    expect(toastSuccess).toHaveBeenCalledWith('更新成功');
    expect(notifyEntityChanged).toHaveBeenCalledWith('payment');
    expect(api.get).toHaveBeenCalledTimes(2);
  });

  it('自定义更新可把已审批记录改走变更审批', async () => {
    const customUpdate = vi.fn().mockResolvedValue({ message: '已提交变更审批' });
    const { result } = renderDetail(customUpdate);

    await waitFor(() => expect(result.current.formData.amount).toBe(100));
    act(() => result.current.enterEditMode());
    act(() => result.current.updateFormField('amount', 120));
    await act(async () => result.current.handleSave());

    expect(customUpdate).toHaveBeenCalledWith({
      entity,
      payload: { amount: 120, version: 2 },
      endpoint: '/payments',
      id: 'payment-1',
    });
    expect(api.put).not.toHaveBeenCalled();
    expect(toastSuccess).toHaveBeenCalledWith('已提交变更审批');
    expect(notifyEntityChanged).toHaveBeenCalledWith('payment');
    expect(api.get).toHaveBeenCalledTimes(2);
  });

  it('每次 render 的新 customUpdate 不改变保存回调身份，且保存读取最新实现', async () => {
    const customUpdateCall = vi.fn();
    const { result, rerender } = renderWithUnstableCustomUpdate(customUpdateCall);

    await waitFor(() => expect(result.current.formData.amount).toBe(100));
    act(() => result.current.enterEditMode());
    act(() => result.current.updateFormField('amount', 120));
    const handleSaveBeforeMapperChange = result.current.handleSave;

    rerender({ implementation: '最新实现' });

    expect(result.current.handleSave).toBe(handleSaveBeforeMapperChange);
    await act(async () => result.current.handleSave());
    expect(customUpdateCall).toHaveBeenCalledWith('最新实现', { amount: 120, version: 2 });
    expect(toastSuccess).toHaveBeenCalledWith('最新实现');
  });

  it('新 mapper 的 Suspense render 被中止时，已提交保存闭包仍使用 A mapper', async () => {
    interface HarnessConfig {
      payloadOffset: number;
      suspend: boolean;
    }

    const blocker = new Promise<void>(() => undefined);
    let setConfig!: (config: HarnessConfig) => void;
    let committedDetail: UseDrawerEntityDetailReturn<PaymentEntity, PaymentForm> | null = null;
    let suspendedRenderCount = 0;

    function Harness() {
      const [config, updateConfig] = useState<HarnessConfig>({
        payloadOffset: 0,
        suspend: false,
      });
      const detail = useDrawerEntityDetail<PaymentEntity, PaymentForm>({
        endpoint: '/payments',
        id: entity.id,
        entityType: 'payment',
        schema,
        toFormData: (data) => ({ amount: data.amount, version: data.version }),
        toPayload: (form) => ({ ...form, amount: form.amount + config.payloadOffset }),
        entityNameOf,
      });

      useLayoutEffect(() => {
        setConfig = updateConfig;
        committedDetail = detail;
      }, [detail, updateConfig]);

      if (config.suspend) {
        suspendedRenderCount += 1;
        throw blocker;
      }
      return null;
    }

    vi.mocked(api.put).mockResolvedValueOnce({
      data: { ...entity, amount: 120, version: 3 },
    });
    render(
      createElement(
        StrictMode,
        null,
        createElement(
          Suspense,
          { fallback: createElement('span', null, 'loading') },
          createElement(Harness)
        )
      )
    );

    await waitFor(() => expect(committedDetail?.formData.amount).toBe(100));
    act(() => committedDetail!.enterEditMode());
    act(() => committedDetail!.updateFormField('amount', 120));
    await waitFor(() => expect(committedDetail?.formData.amount).toBe(120));
    const committedHandleSave = committedDetail!.handleSave;

    await act(async () => {
      startTransition(() => setConfig({ payloadOffset: 1000, suspend: true }));
      await Promise.resolve();
    });
    await waitFor(() => expect(suspendedRenderCount).toBeGreaterThan(0));

    await act(async () => committedHandleSave());

    expect(api.put).toHaveBeenCalledWith('/payments/payment-1', {
      amount: 120,
      version: 2,
    });
  });

  it('data 不变时每次 render 的新 mapper 不会反复 set 表单对象', async () => {
    const mapperCall = vi.fn();
    const { result, rerender } = renderWithUnstableMappers(mapperCall);

    await waitFor(() => expect(result.current.formData.amount).toBe(100));
    const firstFormData = result.current.formData;
    expect(mapperCall).toHaveBeenCalledTimes(1);

    rerender({ formOffset: 0, payloadOffset: 0 });

    expect(result.current.formData).toBe(firstFormData);
    expect(mapperCall).toHaveBeenCalledTimes(1);
  });

  it('data 身份变化时使用当前 mapper 重算表单', async () => {
    const mapperCall = vi.fn();
    const { result, rerender } = renderWithUnstableMappers(mapperCall);
    await waitFor(() => expect(result.current.formData.amount).toBe(100));

    fetchedEntity = { ...fetchedEntity, amount: 180, version: 3 };
    rerender({ formOffset: 5, payloadOffset: 0 });
    await act(async () => result.current.refetch());

    await waitFor(() => expect(result.current.formData).toEqual({ amount: 185, version: 3 }));
    expect(mapperCall).toHaveBeenCalledTimes(2);
    expect(mapperCall).toHaveBeenLastCalledWith(5, 3);
  });

  it('同一 data 对象的 version 变化也会触发表单重算', async () => {
    const mapperCall = vi.fn();
    const { result, rerender } = renderWithUnstableMappers(mapperCall);
    await waitFor(() => expect(result.current.formData.amount).toBe(100));

    fetchedEntity.amount = 190;
    fetchedEntity.version = 3;
    rerender({ formOffset: 0, payloadOffset: 0 });
    await act(async () => result.current.refetch());

    await waitFor(() => expect(result.current.formData).toEqual({ amount: 190, version: 3 }));
    expect(mapperCall).toHaveBeenCalledTimes(2);
  });

  it('mapper 语义变化后，下一次 reload 使用最新实现', async () => {
    const mapperCall = vi.fn();
    const { result, rerender } = renderWithUnstableMappers(mapperCall);
    await waitFor(() => expect(result.current.formData.amount).toBe(100));

    // mapper 单独变化不应覆盖当前表单；随后 data reload 才以最新语义重算。
    rerender({ formOffset: 1000, payloadOffset: 0 });
    expect(result.current.formData.amount).toBe(100);
    expect(mapperCall).toHaveBeenCalledTimes(1);

    fetchedEntity = { ...fetchedEntity, amount: 200, version: 3 };
    rerender({ formOffset: 1000, payloadOffset: 0 });
    await act(async () => result.current.refetch());

    await waitFor(() => expect(result.current.formData).toEqual({ amount: 1200, version: 3 }));
    expect(mapperCall).toHaveBeenLastCalledWith(1000, 3);
  });

  it('mapper 语义变化后，保存 payload 与保存后的 reload 都使用最新实现', async () => {
    vi.mocked(api.put).mockResolvedValueOnce({ data: entity });
    const mapperCall = vi.fn();
    const { result, rerender } = renderWithUnstableMappers(mapperCall);
    await waitFor(() => expect(result.current.formData.amount).toBe(100));

    act(() => result.current.enterEditMode());
    act(() => result.current.updateFormField('amount', 120));
    const handleSaveBeforeMapperChange = result.current.handleSave;
    rerender({ formOffset: 1000, payloadOffset: 10 });
    expect(result.current.handleSave).toBe(handleSaveBeforeMapperChange);
    nextRefetchedEntity = { ...entity, amount: 250, version: 3 };

    await act(async () => result.current.handleSave());

    expect(api.put).toHaveBeenCalledWith('/payments/payment-1', { amount: 130, version: 2 });
    await waitFor(() => expect(result.current.formData).toEqual({ amount: 1250, version: 3 }));
    expect(mapperCall).toHaveBeenLastCalledWith(1000, 3);
  });
});
