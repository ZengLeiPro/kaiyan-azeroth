import { render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ApprovalDetailDrawer } from '../approval-detail-drawer';

const mocks = vi.hoisted(() => ({
  apiGet: vi.fn(),
  loggerError: vi.fn(),
  push: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock('@/lib/api', () => ({
  api: {
    get: mocks.apiGet,
  },
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    error: mocks.loggerError,
  },
}));

vi.mock('sonner', () => ({
  toast: {
    error: mocks.toastError,
  },
}));

vi.mock('@/components/patterns/drawer-stack', () => ({
  useDrawerStackOptional: () => ({
    push: mocks.push,
  }),
}));

describe('ApprovalDetailDrawer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('父组件重渲染更换回调时，不取消正在打开的审批详情', async () => {
    let resolveResponse: (value: {
      data: {
        id: string;
        eventType: string;
        formId: string;
        title: string;
      };
    }) => void;

    const request = new Promise<{
      data: {
        id: string;
        eventType: string;
        formId: string;
        title: string;
      };
    }>((resolve) => {
      resolveResponse = resolve;
    });

    mocks.apiGet.mockReturnValue(request);
    const firstOpenChange = vi.fn();
    const secondOpenChange = vi.fn();
    const firstSuccess = vi.fn();
    const secondSuccess = vi.fn();

    const { rerender } = render(
      <ApprovalDetailDrawer
        open
        onOpenChange={firstOpenChange}
        instanceId="inst-1"
        onSuccess={firstSuccess}
      />
    );

    rerender(
      <ApprovalDetailDrawer
        open
        onOpenChange={secondOpenChange}
        instanceId="inst-1"
        onSuccess={secondSuccess}
      />
    );

    resolveResponse!({
      data: {
        id: 'inst-1',
        eventType: 'sale_order_activate',
        formId: 'sale-order-1',
        title: '合同订单审批',
      },
    });

    await waitFor(() => expect(mocks.push).toHaveBeenCalledTimes(1));
    expect(mocks.apiGet).toHaveBeenCalledTimes(1);
    expect(firstOpenChange).not.toHaveBeenCalled();
    expect(secondOpenChange).toHaveBeenCalledWith(false);

    const pushedEntry = mocks.push.mock.calls[0]?.[0];
    expect(pushedEntry).toMatchObject({
      type: 'sale-order',
      id: 'sale-order-1',
      title: '合同订单审批',
      context: {
        approvalInstanceId: 'inst-1',
        approvalEventType: 'sale_order_activate',
      },
    });

    const onApprovalSuccess = pushedEntry?.context?.onApprovalSuccess;
    expect(typeof onApprovalSuccess).toBe('function');
    if (typeof onApprovalSuccess === 'function') {
      onApprovalSuccess();
    }
    expect(firstSuccess).not.toHaveBeenCalled();
    expect(secondSuccess).toHaveBeenCalledTimes(1);
  });

  it('变更审批会打开目标业务实体，并自动定位到最新审批实例', async () => {
    mocks.apiGet
      .mockResolvedValueOnce({
        data: {
          id: 'inst-old',
          eventType: 'sale_order_change',
          formId: 'change-1',
          title: '订单变更审批',
        },
      })
      .mockResolvedValueOnce({
        data: {
          targetId: 'sale-order-1',
          patch: { __latestApprovalInstanceId: 'inst-latest' },
        },
      });

    const onOpenChange = vi.fn();
    render(
      <ApprovalDetailDrawer
        open
        onOpenChange={onOpenChange}
        instanceId="inst-old"
        onSuccess={vi.fn()}
      />
    );

    await waitFor(() => expect(mocks.push).toHaveBeenCalledTimes(1));
    expect(mocks.apiGet).toHaveBeenNthCalledWith(1, '/approvals/inst-old');
    expect(mocks.apiGet).toHaveBeenNthCalledWith(2, '/approvals/change-requests/change-1');
    expect(mocks.push).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'sale-order',
        id: 'sale-order-1',
        context: expect.objectContaining({ approvalInstanceId: 'inst-latest' }),
      })
    );
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('变更申请加载失败时仍打开降级业务详情，保留审批操作入口', async () => {
    mocks.apiGet
      .mockResolvedValueOnce({
        data: {
          id: 'inst-broken',
          eventType: 'sale_order_change',
          formId: 'change-missing',
          title: '订单变更审批',
        },
      })
      .mockRejectedValueOnce(new Error('变更申请不存在'));

    const onOpenChange = vi.fn();
    render(<ApprovalDetailDrawer open onOpenChange={onOpenChange} instanceId="inst-broken" />);

    await waitFor(() => expect(mocks.push).toHaveBeenCalledTimes(1));
    expect(mocks.push).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'sale-order',
        id: 'change-missing',
        context: expect.objectContaining({ approvalInstanceId: 'inst-broken' }),
      })
    );
    expect(mocks.toastError).toHaveBeenCalledWith('业务单加载失败，已保留审批操作');
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('回款变更审批的变更申请加载失败时仍打开回款详情', async () => {
    mocks.apiGet
      .mockResolvedValueOnce({
        data: {
          id: 'payment-inst-broken',
          eventType: 'payment_change',
          formId: 'payment-change-missing',
          title: '回款变更审批',
        },
      })
      .mockRejectedValueOnce(new Error('变更申请不存在'));

    const onOpenChange = vi.fn();
    render(
      <ApprovalDetailDrawer open onOpenChange={onOpenChange} instanceId="payment-inst-broken" />
    );

    await waitFor(() => expect(mocks.push).toHaveBeenCalledTimes(1));
    expect(mocks.push).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'payment',
        id: 'payment-change-missing',
        context: expect.objectContaining({ approvalInstanceId: 'payment-inst-broken' }),
      })
    );
    expect(mocks.toastError).toHaveBeenCalledWith('业务单加载失败，已保留审批操作');
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('不支持的审批类型会提示错误并关闭入口', async () => {
    mocks.apiGet.mockResolvedValue({
      data: {
        id: 'inst-unknown',
        eventType: 'unknown_event',
        formId: 'form-1',
        title: '未知审批',
      },
    });

    const onOpenChange = vi.fn();
    render(<ApprovalDetailDrawer open onOpenChange={onOpenChange} instanceId="inst-unknown" />);

    await waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith('当前审批类型暂不支持在业务详情中打开')
    );
    expect(mocks.push).not.toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
