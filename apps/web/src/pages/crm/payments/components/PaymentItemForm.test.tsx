import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { FormModeProvider } from '@/components/patterns/form-field';
import { api } from '@/lib/api';

import { PaymentItemForm } from './PaymentItemForm';

vi.mock('@/lib/api', () => ({
  api: { get: vi.fn() },
}));

const getMock = vi.mocked(api.get);

const contractProducts = [
  { id: 'product-1', productName: '钉钉专业版', subtotalAmount: 1000 },
  { id: 'product-2', productName: '实施服务', subtotalAmount: 2000 },
];

const expectedProductRows = [
  {
    tempId: 'pi-product-1',
    saleOrderProductId: 'product-1',
    productName: '钉钉专业版',
    amount: 1000,
    paymentMode: 'direct',
    remark: null,
  },
  {
    tempId: 'pi-product-2',
    saleOrderProductId: 'product-2',
    productName: '实施服务',
    amount: 2000,
    paymentMode: 'direct',
    remark: null,
  },
];

describe('PaymentItemForm', () => {
  beforeEach(() => vi.clearAllMocks());

  it('新建回款选择合同后自动带入全部合同产品', async () => {
    getMock.mockResolvedValue({ data: { products: contractProducts } });
    const onChange = vi.fn();
    const { rerender } = render(
      <FormModeProvider mode="create">
        <PaymentItemForm
          saleOrderId=""
          value={[]}
          paymentAmount={3000}
          onChange={onChange}
          autoPopulate
        />
      </FormModeProvider>
    );

    rerender(
      <FormModeProvider mode="create">
        <PaymentItemForm
          saleOrderId="order-1"
          value={[]}
          paymentAmount={3000}
          onChange={onChange}
          autoPopulate
        />
      </FormModeProvider>
    );

    await waitFor(() => {
      expect(onChange).toHaveBeenLastCalledWith(expectedProductRows);
    });
  });

  it('新建回款切换合同后用新合同产品替换旧明细', async () => {
    getMock.mockResolvedValueOnce({ data: { products: contractProducts } }).mockResolvedValueOnce({
      data: {
        products: [{ id: 'product-3', productName: '续费服务', subtotalAmount: 3000 }],
      },
    });
    const onChange = vi.fn();
    const { rerender } = render(
      <FormModeProvider mode="create">
        <PaymentItemForm
          saleOrderId="order-1"
          value={expectedProductRows}
          paymentAmount={3000}
          onChange={onChange}
          autoPopulate
        />
      </FormModeProvider>
    );

    rerender(
      <FormModeProvider mode="create">
        <PaymentItemForm
          saleOrderId="order-2"
          value={expectedProductRows}
          paymentAmount={3000}
          onChange={onChange}
          autoPopulate
        />
      </FormModeProvider>
    );

    await waitFor(() => {
      expect(onChange).toHaveBeenLastCalledWith([
        {
          tempId: 'pi-product-3',
          saleOrderProductId: 'product-3',
          productName: '续费服务',
          amount: 3000,
          paymentMode: 'direct',
          remark: null,
        },
      ]);
    });
  });

  it('新建回款清空合同后清空自动带入的明细', () => {
    getMock.mockResolvedValue({ data: { products: contractProducts } });
    const onChange = vi.fn();
    const { rerender } = render(
      <FormModeProvider mode="create">
        <PaymentItemForm
          saleOrderId="order-1"
          value={expectedProductRows}
          paymentAmount={3000}
          onChange={onChange}
          autoPopulate
        />
      </FormModeProvider>
    );

    rerender(
      <FormModeProvider mode="create">
        <PaymentItemForm
          saleOrderId=""
          value={expectedProductRows}
          paymentAmount={0}
          onChange={onChange}
          autoPopulate
        />
      </FormModeProvider>
    );

    expect(onChange).toHaveBeenLastCalledWith([]);
  });

  it('编辑已有回款时保留原有产品明细', async () => {
    getMock.mockResolvedValue({ data: { products: contractProducts } });
    const onChange = vi.fn();

    render(
      <FormModeProvider mode="create">
        <PaymentItemForm
          saleOrderId="order-1"
          value={expectedProductRows}
          paymentAmount={3000}
          onChange={onChange}
        />
      </FormModeProvider>
    );

    await waitFor(() => {
      expect(getMock).toHaveBeenCalledWith('/sale-orders/order-1');
    });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('value 为 nullish 时不抛异常，按空明细处理', () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <FormModeProvider mode="create">
        <PaymentItemForm saleOrderId="order-1" value={null} paymentAmount={0} onChange={onChange} />
      </FormModeProvider>
    );

    expect(screen.getByText('至少需要一条拆分明细')).toBeTruthy();

    rerender(
      <FormModeProvider mode="create">
        <PaymentItemForm
          saleOrderId="order-1"
          value={undefined}
          paymentAmount={0}
          onChange={onChange}
        />
      </FormModeProvider>
    );

    expect(screen.getByText('至少需要一条拆分明细')).toBeTruthy();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('value 为非数组对象时显示数据契约异常提示', () => {
    const onChange = vi.fn();
    render(
      <FormModeProvider mode="create">
        <PaymentItemForm
          saleOrderId="order-1"
          value={{ unexpected: true } as never}
          paymentAmount={0}
          onChange={onChange}
        />
      </FormModeProvider>
    );

    expect(screen.getByText(/拆分明细数据格式异常/)).toBeTruthy();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('只读（view）模式渲染持久化快照文本，无编辑控件、无订单产品请求', async () => {
    getMock.mockResolvedValue({ data: { products: contractProducts } });
    const onChange = vi.fn();
    render(
      <FormModeProvider mode="view">
        <PaymentItemForm
          saleOrderId="order-1"
          value={expectedProductRows}
          paymentAmount={3000}
          onChange={onChange}
          autoPopulate
        />
      </FormModeProvider>
    );

    // 快照文本显示，操作按钮不显示
    expect(screen.getByText('钉钉专业版')).toBeTruthy();
    expect(screen.getAllByText('直收（招商/兴业账户）').length).toBe(2);
    expect(screen.queryByText('添加一行')).toBeNull();
    expect(screen.queryByText('差额补到最后一行')).toBeNull();
    expect(screen.queryByRole('button', { name: '' })).toBeNull();

    // view 模式不拉订单产品
    expect(getMock).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('只读（view）模式空明细显示可解释空态', () => {
    render(
      <FormModeProvider mode="view">
        <PaymentItemForm saleOrderId="order-1" value={[]} paymentAmount={0} onChange={vi.fn()} />
      </FormModeProvider>
    );

    expect(screen.getByText('未记录产品拆分明细')).toBeTruthy();
  });
});
