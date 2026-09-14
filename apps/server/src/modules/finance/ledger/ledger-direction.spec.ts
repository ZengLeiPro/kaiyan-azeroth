import { describe, expect, it, vi } from 'vitest';

import type { PrismaService } from '../../../common/prisma/prisma.service';
import { FinanceLedgerService } from './ledger.service';

const user = { id: 'user-1', employeeId: 'employee-1' };

describe('FinanceLedgerService direction 单源', () => {
  it('create 忽略冲突的客户端 direction，按 amount 符号派生', async () => {
    const prisma = {
      financeLedger: {
        create: vi.fn().mockImplementation(({ data }) => ({
          id: 'ledger-1',
          ...data,
          amount: '-100.00',
          account: null,
          subject: null,
        })),
      },
    };
    const service = new FinanceLedgerService(prisma as unknown as PrismaService);

    await service.create(
      {
        txDate: '2026-09-04',
        accountId: '00000000-0000-4000-8000-000000000001',
        subjectId: '00000000-0000-4000-8000-000000000002',
        amount: -100,
        direction: 'in',
      },
      user
    );

    expect(prisma.financeLedger.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ amount: -100, direction: 'out' }) })
    );
  });

  it('update 单独提交 direction 不改变数据库方向', async () => {
    const prisma = {
      financeLedger: {
        findFirst: vi.fn().mockResolvedValue({ id: 'ledger-1', amount: '-100', direction: 'out' }),
        findUnique: vi.fn().mockResolvedValue({ paymentId: null, source: 'manual' }),
        update: vi.fn().mockResolvedValue({
          id: 'ledger-1',
          amount: '-100',
          direction: 'out',
          account: null,
          subject: null,
        }),
      },
    };
    const service = new FinanceLedgerService(prisma as unknown as PrismaService);

    await service.update('ledger-1', { direction: 'in' }, user);

    expect(prisma.financeLedger.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.not.objectContaining({ direction: expect.anything() }),
      })
    );
  });
});
