import type { ICustomerResponse } from '@ky-azeroth/shared/types/customer';
import type { IPaymentResponse } from '@ky-azeroth/shared/types/payment';
import { act, render, renderHook, waitFor } from '@testing-library/react';
import type { ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { api } from '@/lib/api';
import type { CustomerFormData } from '@/pages/crm/customers/types';

import customerFieldsSource from '../../pages/crm/customers/customer-fields.tsx?raw';
import invoiceFieldsSource from '../../pages/crm/invoices/invoice-fields.tsx?raw';
import keepRecordFieldsSource from '../../pages/crm/keep-records/keep-record-fields.tsx?raw';
import opportunityFieldsSource from '../../pages/crm/opportunities/opportunity-fields.tsx?raw';
import paymentFieldsSource from '../../pages/crm/payments/payment-fields.tsx?raw';
import saleOrderFieldsSource from '../../pages/crm/sale-orders/sale-order-fields.tsx?raw';
import visitRecordFieldsSource from '../../pages/crm/visit-records/visit-record-fields.tsx?raw';
import type { UseDrawerEntityDetailOptions } from '../use-drawer-entity-detail';

interface RegisteredRenderer {
  render: (id: string, context?: Record<string, unknown>) => unknown;
}

const callsiteState = vi.hoisted(() => ({
  registrations: new Map<string, unknown>(),
  hookOptions: [] as unknown[],
  notifyEntityChanged: vi.fn(),
  pop: vi.fn(),
  setBeforeCloseGuard: vi.fn(),
}));

vi.mock('@/components/patterns/drawer-stack', async () => {
  const actual = await vi.importActual<typeof import('@/components/patterns/drawer-stack')>(
    '@/components/patterns/drawer-stack'
  );
  return {
    ...actual,
    EntityDetailBody: () => null,
    registerEntityDetail: (type: string, renderer: unknown) => {
      callsiteState.registrations.set(type, renderer);
    },
    useDrawerStack: () => ({
      notifyEntityChanged: callsiteState.notifyEntityChanged,
      pop: callsiteState.pop,
    }),
    useEntityHeaderActions: () => undefined,
    useSetBeforeCloseGuard: () => callsiteState.setBeforeCloseGuard,
  };
});

vi.mock('@/components/patterns/drawer-stack/context', () => ({
  useDrawerStack: () => ({
    notifyEntityChanged: callsiteState.notifyEntityChanged,
    pop: callsiteState.pop,
  }),
}));

vi.mock('@/components/patterns/drawer-stack/before-close-context', () => ({
  useSetBeforeCloseGuard: () => callsiteState.setBeforeCloseGuard,
}));

vi.mock('@/components/patterns/business-approval-section', () => ({
  BusinessApprovalSection: () => null,
}));

vi.mock('@/hooks/use-mobile', () => ({
  useIsMobile: () => false,
}));

vi.mock('@/hooks/use-drawer-entity-detail', () => ({
  useDrawerEntityDetail: (options: unknown) => {
    callsiteState.hookOptions.push(options);
    return {
      data: null,
      loading: false,
      error: null,
      refetch: async () => undefined,
      mode: 'view',
      isDirty: false,
      formData: {},
      updateFormField: () => undefined,
      getFieldError: () => undefined,
      enterEditMode: () => undefined,
      exitEditMode: () => undefined,
      handleSave: async () => undefined,
      saving: false,
      requestDelete: () => undefined,
      deleteConfirmProps: {
        open: false,
        onOpenChange: () => undefined,
        entityName: '',
        onConfirm: async () => undefined,
        loading: false,
      },
    };
  },
}));

vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api');
  return {
    ...actual,
    api: {
      ...actual.api,
      get: vi.fn(),
      put: vi.fn(),
      post: vi.fn(),
      delete: vi.fn(),
    },
  };
});

const DETAIL_CALL_SITES = [
  {
    name: 'Customer',
    source: customerFieldsSource,
    endpoint: '/customers',
    entityType: 'customer',
  },
  {
    name: 'KeepRecord',
    source: keepRecordFieldsSource,
    endpoint: '/keep-records',
    entityType: 'keep-record',
  },
  {
    name: 'VisitRecord',
    source: visitRecordFieldsSource,
    endpoint: '/visit-records',
    entityType: 'visit-record',
  },
  {
    name: 'Payment',
    source: paymentFieldsSource,
    endpoint: '/payments',
    entityType: 'payment',
  },
  {
    name: 'Invoice',
    source: invoiceFieldsSource,
    endpoint: '/invoices',
    entityType: 'invoice',
  },
  {
    name: 'Opportunity',
    source: opportunityFieldsSource,
    endpoint: '/opportunities',
    entityType: 'opportunity',
  },
  {
    name: 'SaleOrder',
    source: saleOrderFieldsSource,
    endpoint: '/sale-orders',
    entityType: 'sale-order',
  },
] as const;

async function captureRegisteredOptions<TResp, TForm>(
  entityType: 'customer' | 'payment',
  id: string
): Promise<UseDrawerEntityDetailOptions<TResp, TForm>> {
  if (entityType === 'customer') {
    await import('../../pages/crm/customers/customer-fields');
  } else {
    await import('../../pages/crm/payments/payment-fields');
  }

  const renderer = callsiteState.registrations.get(entityType) as RegisteredRenderer | undefined;
  expect(renderer).toBeDefined();
  const previousCallCount = callsiteState.hookOptions.length;
  const view = render(renderer!.render(id) as ReactElement);
  await waitFor(() => expect(callsiteState.hookOptions.length).toBeGreaterThan(previousCallCount));
  view.unmount();
  return callsiteState.hookOptions.at(-1) as UseDrawerEntityDetailOptions<TResp, TForm>;
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function createPaymentResponse({
  id,
  flowStatus,
  paymentAmount,
  version,
}: {
  id: string;
  flowStatus: string;
  paymentAmount: number;
  version: number;
}): IPaymentResponse {
  return {
    id,
    serialNumber: `PAY-${id}`,
    subject: '项目回款',
    saleOrderId: 'sale-order-1',
    customerId: 'customer-1',
    paymentAmount,
    paymentType: null,
    businessDate: null,
    bankName: null,
    tradeSerialNumber: null,
    chargerId: null,
    chargerName: null,
    remark: null,
    flowStatus,
    status: 'pending',
    direction: 'IN',
    legacyAdjustment: false,
    refundType: null,
    refundReason: null,
    relatedPaymentId: null,
    relatedInvoiceId: null,
    version,
  };
}

describe('useDrawerEntityDetail CRM 二级详情调用点', () => {
  it.each(DETAIL_CALL_SITES)(
    '$name 继续通过公共 hook 映射详情数据',
    ({ source, endpoint, entityType }) => {
      expect(source.match(/const crud = useDrawerEntityDetail</g)).toHaveLength(1);
      expect(source).toContain(`endpoint: '${endpoint}'`);
      expect(source).toContain(`entityType: '${entityType}'`);
      expect(source).toMatch(/\btoFormData\s*:/);
    }
  );

  it('CustomerDetailView 的真实 hook 配置使用更新白名单并保留 version', async () => {
    const options = await captureRegisteredOptions<ICustomerResponse, CustomerFormData>(
      'customer',
      'customer-1'
    );
    const form = {
      customerName: '  客户 A  ',
      version: 11,
      aiInfoSummary: '不得回写的 AI 摘要',
      collaboratorName: '不得回写的协作人展示名',
      collaboratorIds: ['employee-1'],
      leadStage: 'MQL',
      leadStageQualifiedById: 'employee-2',
      contactStatus: '已联系',
      dealStatus: '已成交',
    } as CustomerFormData;

    const payload = options.toPayload(form);

    expect(payload).toMatchObject({
      customerName: '客户 A',
      collaboratorIds: ['employee-1'],
      version: 11,
    });
    expect(payload).not.toHaveProperty('aiInfoSummary');
    expect(payload).not.toHaveProperty('collaboratorName');
    expect(payload).not.toHaveProperty('leadStage');
    expect(payload).not.toHaveProperty('leadStageQualifiedById');
    expect(payload).not.toHaveProperty('contactStatus');
    expect(payload).not.toHaveProperty('dealStatus');
  }, 60_000);

  it('PaymentDetailView 未审批 PUT v3 会提交快照，后续旧 GET v2 不得降版本', async () => {
    interface PaymentForm {
      amount: number;
      version: number;
    }

    const options = await captureRegisteredOptions<IPaymentResponse, PaymentForm>(
      'payment',
      'payment-1'
    );
    expect(options.customUpdate).toBeDefined();

    const initial = createPaymentResponse({
      id: 'payment-1',
      flowStatus: 'pending',
      paymentAmount: 100,
      version: 2,
    });
    const saved = { ...initial, paymentAmount: 120, version: 3 };
    const staleGet = createDeferred<{ data: IPaymentResponse }>();
    vi.mocked(api.get)
      .mockResolvedValueOnce({ data: initial })
      .mockImplementationOnce(() => staleGet.promise as never);
    vi.mocked(api.put).mockResolvedValueOnce({ data: saved });

    const actualHook = await vi.importActual<typeof import('../use-drawer-entity-detail')>(
      '../use-drawer-entity-detail'
    );
    const { result } = renderHook(() =>
      actualHook.useDrawerEntityDetail<IPaymentResponse, PaymentForm>({
        endpoint: '/payments',
        id: 'payment-1',
        entityType: 'payment',
        schema: z.object({ amount: z.number().positive(), version: z.number().int() }),
        toFormData: (data) => ({
          amount: Number(data.paymentAmount),
          version: data.version!,
        }),
        toPayload: (form) => form,
        customUpdate: options.customUpdate,
      })
    );

    await waitFor(() => expect(result.current.data).toEqual(initial));
    act(() => result.current.enterEditMode());
    act(() => result.current.updateFormField('amount', 120));
    let savePromise!: Promise<void>;
    act(() => {
      savePromise = result.current.handleSave();
    });

    await waitFor(() =>
      expect(api.put).toHaveBeenCalledWith('/payments/payment-1', {
        amount: 120,
        version: 2,
      })
    );
    await waitFor(() => expect(api.get).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(result.current.data).toEqual(saved));

    await act(async () => {
      staleGet.resolve({ data: initial });
      await savePromise;
    });

    expect(result.current.data).toEqual(saved);
    expect(result.current.formData).toEqual({ amount: 120, version: 3 });
  }, 60_000);

  it('PaymentDetailView 已审批分支只返回审批消息，不伪造实体快照', async () => {
    interface PaymentForm {
      amount: number;
      version: number;
    }

    const options = await captureRegisteredOptions<IPaymentResponse, PaymentForm>(
      'payment',
      'payment-approved'
    );
    const approved = createPaymentResponse({
      id: 'payment-approved',
      flowStatus: 'approved',
      paymentAmount: 100,
      version: 2,
    });
    vi.mocked(api.post).mockResolvedValueOnce({ data: { id: 'change-request-1' } });

    const result = await options.customUpdate!({
      entity: approved,
      payload: { amount: 120, version: 2 },
      endpoint: '/payments',
      id: approved.id,
    });

    expect(api.post).toHaveBeenCalledWith('/payments/payment-approved/change-request', {
      amount: 120,
      version: 2,
    });
    expect(result).toEqual({ message: '已提交变更审批' });
    expect(result).not.toHaveProperty('data');
  }, 60_000);
});
