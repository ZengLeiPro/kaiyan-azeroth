import { describe, expect, it, vi } from 'vitest';

import { recomputeCustomerAccountsReceivable } from '../customer-accounts-receivable.helper';

describe('recomputeCustomerAccountsReceivable', () => {
  it('回写失败必须向外抛出，禁止主事务提交半套派生事实', async () => {
    const error = new Error('customer update failed');
    const prisma = {
      customer: {
        findFirst: vi.fn().mockResolvedValue({ id: 'customer-1' }),
        update: vi.fn().mockRejectedValue(error),
      },
      saleOrder: {
        aggregate: vi.fn().mockResolvedValue({ _sum: { totalUncollected: '123.45' } }),
      },
    };

    await expect(recomputeCustomerAccountsReceivable(prisma as never, 'customer-1')).rejects.toBe(
      error
    );
  });

  it('活动客户按订单未收合计严格回写', async () => {
    const prisma = {
      customer: {
        findFirst: vi.fn().mockResolvedValue({ id: 'customer-1' }),
        update: vi.fn().mockResolvedValue({ id: 'customer-1' }),
      },
      saleOrder: {
        aggregate: vi.fn().mockResolvedValue({ _sum: { totalUncollected: '123.45' } }),
      },
    };

    await recomputeCustomerAccountsReceivable(prisma as never, 'customer-1');

    expect(prisma.customer.update).toHaveBeenCalledWith({
      where: { id: 'customer-1' },
      data: { accountsReceivable: '123.45' },
    });
  });
});
