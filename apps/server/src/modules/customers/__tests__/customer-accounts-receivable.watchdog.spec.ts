import { describe, expect, it, vi } from 'vitest';

import type { PrismaService } from '../../../common/prisma/prisma.service';
import { CustomerAccountsReceivableWatchdog } from '../customer-accounts-receivable.watchdog';

describe('CustomerAccountsReceivableWatchdog', () => {
  it('发现差异时写入可观测 OperationLog', async () => {
    const prisma = {
      $queryRaw: vi
        .fn()
        .mockResolvedValue([{ customerId: 'customer-1', cached: '10.00', computed: '25.00' }]),
      operationLog: { create: vi.fn().mockResolvedValue({ id: 'log-1' }) },
    };
    const watchdog = new CustomerAccountsReceivableWatchdog(prisma as unknown as PrismaService);

    await watchdog.handleDailyAudit();

    expect(prisma.operationLog.create).toHaveBeenCalledOnce();
    expect(prisma.operationLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        module: 'finance',
        action: 'watchdog',
        target: 'customer-accounts-receivable-out-of-sync',
      }),
    });
  });

  it('无差异时不写 OperationLog', async () => {
    const prisma = {
      $queryRaw: vi.fn().mockResolvedValue([]),
      operationLog: { create: vi.fn() },
    };
    const watchdog = new CustomerAccountsReceivableWatchdog(prisma as unknown as PrismaService);

    await watchdog.handleDailyAudit();

    expect(prisma.operationLog.create).not.toHaveBeenCalled();
  });

  it.each([
    [new Error('database unavailable'), 'database unavailable'],
    ['connection closed', 'connection closed'],
  ])('对账查询失败时吞掉异常并记录原因：%s', async (error, expectedMessage) => {
    const prisma = {
      $queryRaw: vi.fn().mockRejectedValue(error),
      operationLog: { create: vi.fn() },
    };
    const watchdog = new CustomerAccountsReceivableWatchdog(prisma as unknown as PrismaService);
    const loggerError = vi.spyOn(watchdog['logger'], 'error').mockImplementation(() => undefined);

    await expect(watchdog.handleDailyAudit()).resolves.toBeUndefined();

    expect(loggerError).toHaveBeenCalledWith(
      `Customer.accountsReceivable 对账失败：${expectedMessage}`
    );
    expect(prisma.operationLog.create).not.toHaveBeenCalled();
  });
});
