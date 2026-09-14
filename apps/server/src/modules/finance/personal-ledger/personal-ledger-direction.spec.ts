import { describe, expect, it, vi } from 'vitest';

import type { PrismaService } from '../../../common/prisma/prisma.service';
import { FinancePersonalLedgerService } from './personal-ledger.service';

describe('FinancePersonalLedgerService direction 单源', () => {
  it('create 永远按 amount 符号派生 direction', async () => {
    const prisma = {
      financePersonalLedger: {
        create: vi.fn().mockImplementation(({ data }) => ({
          id: 'ledger-1',
          ...data,
          amount: '100.00',
          account: null,
          subject: null,
        })),
      },
    };
    const service = new FinancePersonalLedgerService(prisma as unknown as PrismaService);

    await service.create(
      {
        txDate: '2026-09-04',
        accountId: '00000000-0000-4000-8000-000000000001',
        subjectId: '00000000-0000-4000-8000-000000000002',
        amount: 100,
        direction: 'out',
      },
      { id: 'user-1', employeeId: 'employee-1' }
    );

    expect(prisma.financePersonalLedger.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ amount: 100, direction: 'in' }) })
    );
  });
});
