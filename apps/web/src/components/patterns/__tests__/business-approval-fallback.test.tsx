import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { BusinessApprovalFallback } from '../business-approval-fallback';

const mocks = vi.hoisted(() => ({
  businessApprovalSection: vi.fn(),
}));

vi.mock('../business-approval-section', () => ({
  BusinessApprovalSection: (props: Record<string, unknown>) => {
    mocks.businessApprovalSection(props);
    return <div>审批面板</div>;
  },
}));

describe('BusinessApprovalFallback', () => {
  beforeEach(() => {
    mocks.businessApprovalSection.mockClear();
  });

  it('保留审批面板、加载失败提示和业务单重试入口', () => {
    const onRetry = vi.fn();
    const onApprovalSuccess = vi.fn();

    render(
      <BusinessApprovalFallback
        approvalContext={{
          approvalInstanceId: 'approval-1',
          approvalEventType: 'sale_order_change',
          onApprovalSuccess,
        }}
        defaultEventType="sale_order_activate"
        formId="sale-order-1"
        onRetry={onRetry}
      />
    );

    expect(screen.getByText('审批面板')).toBeTruthy();
    expect(screen.getByText('业务单加载失败，但你仍可查看并处理当前审批。')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '重试加载业务单' }));

    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(mocks.businessApprovalSection).toHaveBeenCalledWith(
      expect.objectContaining({
        approvalInstanceId: 'approval-1',
        approvalEventType: 'sale_order_change',
        eventType: 'sale_order_change',
        formId: 'sale-order-1',
        onApprovalSuccess,
        onSuccess: onRetry,
      })
    );
  });

  it('没有审批实例时不渲染降级入口', () => {
    const { container } = render(
      <BusinessApprovalFallback
        approvalContext={{ approvalInstanceId: null }}
        defaultEventType="sale_order_activate"
        formId="sale-order-1"
        onRetry={vi.fn()}
      />
    );

    expect(container.innerHTML).toBe('');
    expect(mocks.businessApprovalSection).not.toHaveBeenCalled();
  });
});
