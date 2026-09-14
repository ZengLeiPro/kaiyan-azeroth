// 导入业务模块以同步注册 'payment' renderer（registerEntityDetail 在模块加载时执行）
import '../payment-fields';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  DrawerStackHost,
  DrawerStackProvider,
  useDrawerStack,
} from '@/components/patterns/drawer-stack';

const mocks = vi.hoisted(() => ({
  apiGet: vi.fn(),
}));

vi.mock('@/lib/api', () => ({
  api: { get: mocks.apiGet, post: vi.fn(), put: vi.fn(), delete: vi.fn() },
  getErrorMessage: (error: unknown) => (error instanceof Error ? error.message : '操作失败'),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

/** 桌面端断点：jsdom 无 matchMedia，stub 成桌面（max-width 不匹配）。 */
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }))
  );
});

/**
 * 一条已通过的 IN 回款（合成数据，非生产记录）。
 * items 至少一条，用于断言产品拆分真实显示。
 */
function buildApprovedPayment() {
  return {
    id: 'pay-test-1',
    serialNumber: 'PAY-TEST01',
    subject: '首期款',
    saleOrderId: 'so-1',
    customerId: 'cus-1',
    paymentAmount: '9800.00',
    paymentType: '银行转账',
    businessDate: '2026-09-11',
    bankName: '招商银行',
    tradeSerialNumber: null,
    chargerId: 'emp-1',
    chargerName: '周销售',
    remark: null,
    flowStatus: 'approved',
    status: 'approved',
    direction: 'IN',
    legacyAdjustment: false,
    refundType: null,
    refundReason: null,
    relatedPaymentId: null,
    relatedInvoiceId: null,
    version: 1,
    customer: { id: 'cus-1', customerName: '虚构客户', shortName: null },
    saleOrder: { id: 'so-1', orderTitle: '虚构合同', serialNumber: 'SO-TEST01' },
    items: [
      {
        id: 'item-1',
        paymentId: 'pay-test-1',
        saleOrderProductId: 'product-1',
        itemSeq: 1,
        productName: '钉钉专业版',
        amount: '9800.00',
        financeSubjectId: null,
        paymentMode: 'direct',
        remark: null,
      },
    ],
    refundedAmount: null,
    refundableAmount: null,
  };
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** 通过真实 DrawerStackProvider push 一条 payment detail entry 并渲染。 */
function renderPaymentDetail(id: string) {
  const pushRef: { current: ((entry: { type: 'payment'; id: string }) => void) | null } = {
    current: null,
  };
  function Pusher() {
    const stack = useDrawerStack();
    pushRef.current = stack.push;
    return null;
  }
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const utils = render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <DrawerStackProvider>
          <Pusher />
          <DrawerStackHost />
        </DrawerStackProvider>
      </MemoryRouter>
    </QueryClientProvider>
  );
  if (!pushRef.current) throw new Error('Pusher 未获取到 drawerStack.push');
  pushRef.current({ type: 'payment', id });
  return utils;
}

describe('PaymentDetailView 首次异步加载（回归：回款审批通知点击后页面显示失败）', () => {
  it('T01 接口返回有效数据后，回款内容与产品拆分正确显示且不抛渲染异常', async () => {
    const deferred = createDeferred<{ data: unknown }>();
    mocks.apiGet.mockImplementation((url: string) => {
      if (url === '/payments/pay-test-1') return deferred.promise;
      // PaymentItemForm 拉订单产品 + ApprovalPanel 按 formId 查审批实例
      if (url === '/sale-orders/so-1')
        return Promise.resolve({
          data: {
            products: [{ id: 'product-1', productName: '钉钉专业版', subtotalAmount: '9800.00' }],
          },
        });
      if (url === '/approvals/form/payment_approve/pay-test-1')
        return Promise.resolve({ data: null });
      return Promise.resolve({ data: null });
    });

    renderPaymentDetail('pay-test-1');

    // loading 已显示，数据尚未返回
    await waitFor(() => {
      expect(mocks.apiGet).toHaveBeenCalledWith('/payments/pay-test-1');
    });

    // 释放响应：旧代码在此后的首个可显示渲染中 formData 仍为 {}，子表对 undefined 调 reduce 抛错
    deferred.resolve({ data: buildApprovedPayment() });

    // 断言真实内容出现，而不只是没有错误页
    await screen.findByText('首期款', {}, { timeout: 3000 });
    expect(screen.getAllByText('9800.00').length).toBeGreaterThan(0);
    // 产品拆分子表渲染出真实行内容
    await screen.findByText(/钉钉专业版/);
  });

  it('T05 历史回款无产品明细时显示可解释的只读空态，不抛异常', async () => {
    const payment = buildApprovedPayment();
    payment.items = [];
    mocks.apiGet.mockImplementation((url: string) => {
      if (url === '/payments/pay-test-2') return Promise.resolve({ data: payment });
      if (url === '/sale-orders/so-1') return Promise.resolve({ data: { products: [] } });
      if (url === '/approvals/form/payment_approve/pay-test-2')
        return Promise.resolve({ data: null });
      return Promise.resolve({ data: null });
    });

    renderPaymentDetail('pay-test-2');

    await screen.findByText('首期款', {}, { timeout: 3000 });
  });
});
