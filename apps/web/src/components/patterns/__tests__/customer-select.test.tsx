import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CustomerSelect } from '../customer-select';

const mocks = vi.hoisted(() => ({ apiGet: vi.fn() }));

vi.mock('@/lib/api', () => ({
  api: { get: mocks.apiGet },
}));

const CUSTOMER = { id: 'cus-1', serialNumber: 'CUS001', customerName: '示例科技' };

function mockCustomerApi() {
  mocks.apiGet.mockImplementation((url: string) =>
    url === '/customers/all'
      ? Promise.resolve({ data: [CUSTOMER] })
      : Promise.resolve({ data: CUSTOMER })
  );
}

function renderWithClient(node: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
}

describe('CustomerSelect', () => {
  beforeEach(() => {
    mocks.apiGet.mockReset();
  });

  it('未选中客户时展示占位文案并按空关键字查询', async () => {
    mocks.apiGet.mockResolvedValue({ data: [] });

    renderWithClient(<CustomerSelect value="" onChange={vi.fn()} />);

    expect(screen.getByRole('combobox').textContent).toContain('搜索并选择客户');
    await waitFor(() =>
      expect(mocks.apiGet).toHaveBeenCalledWith('/customers/all', { params: {} })
    );
  });

  it('已选中客户时展示客户名并回调选中对象', async () => {
    const onSelectedCustomerChange = vi.fn();
    mockCustomerApi();

    renderWithClient(
      <CustomerSelect
        value="cus-1"
        onChange={vi.fn()}
        onSelectedCustomerChange={onSelectedCustomerChange}
      />
    );

    await waitFor(() => expect(screen.getByRole('combobox').textContent).toContain('示例科技'));
    await waitFor(() =>
      expect(onSelectedCustomerChange).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'cus-1' })
      )
    );
  });

  it('点击清除按钮回传空值', async () => {
    const onChange = vi.fn();
    mockCustomerApi();

    renderWithClient(<CustomerSelect value="cus-1" onChange={onChange} />);

    await waitFor(() => expect(screen.getByRole('combobox').textContent).toContain('示例科技'));
    fireEvent.click(screen.getByRole('button', { name: '' }));

    expect(onChange).toHaveBeenCalledWith('');
  });

  it('禁用态下触发按钮不可交互', () => {
    mocks.apiGet.mockResolvedValue({ data: [] });

    renderWithClient(<CustomerSelect value="" onChange={vi.fn()} disabled />);

    expect((screen.getByRole('combobox') as HTMLButtonElement).disabled).toBe(true);
  });
});
