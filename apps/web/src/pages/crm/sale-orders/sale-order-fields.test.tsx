import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { FormModeProvider } from '@/components/patterns/form-field';

import { BadDebtAmountInputField, ReadonlyTotalsFields } from './sale-order-fields';

describe('订单坏账金额字段', () => {
  it('详情模式展示坏账金额', () => {
    render(
      <FormModeProvider mode="view">
        <ReadonlyTotalsFields
          entity={{
            totalReceivables: 1000,
            totalReceived: 300,
            totalRefunded: 0,
            badDebtAmount: 200,
            totalUncollected: 500,
            invoicedAmount: 0,
            orderInvoiceStatus: null,
          }}
        />
      </FormModeProvider>
    );

    expect(screen.getByText('坏账金额')).toBeTruthy();
    expect(screen.getByText('200.00')).toBeTruthy();
  });

  it('编辑模式以数值提交坏账金额，清空时回传 null', () => {
    const onChange = vi.fn();
    render(
      <FormModeProvider mode="edit">
        <BadDebtAmountInputField value={200} onChange={onChange} />
      </FormModeProvider>
    );

    const input = screen.getByLabelText('坏账金额');
    fireEvent.change(input, { target: { value: '350.5' } });
    fireEvent.change(input, { target: { value: '' } });

    expect(onChange).toHaveBeenNthCalledWith(1, 350.5);
    expect(onChange).toHaveBeenNthCalledWith(2, null);
  });
});
