import { describe, expect, it, vi } from 'vitest';

import { CrmChangeLogService } from './crm-change-log.service';
import { OperationLogsService } from './operation-logs.service';

/**
 * deriveTargetCustomerId 是私有 helper，所以测公开入口 logChange：
 * 通过 mock OperationLogsService.log，断言写入时带的 targetCustomerId 是否正确。
 *
 * 这层测试守护 2026-06-16 投影改造的核心承诺：
 * "调用方零改动，service 自动从 before/after 推导客户归属"。
 */
describe('CrmChangeLogService.logChange（targetCustomerId 推导）', () => {
  function mkService() {
    const log = vi.fn().mockResolvedValue(undefined);
    const opLogs = { log } as unknown as OperationLogsService;
    const service = new CrmChangeLogService(opLogs);
    return { service, log };
  }

  const currentUser = { id: 'user1', employeeId: 'emp1' };

  it('module=customers → 用 target（customer.id 本身）', async () => {
    const { service, log } = mkService();
    await service.logChange({
      module: 'customers',
      action: 'create',
      target: 'cust-uuid-1',
      currentUser,
      after: { customerName: '测试客户' },
    });
    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0]![0]).toMatchObject({
      module: 'customers',
      target: 'cust-uuid-1',
      targetCustomerId: 'cust-uuid-1',
    });
  });

  it('module=sale-orders → 用 after.customerId', async () => {
    const { service, log } = mkService();
    await service.logChange({
      module: 'sale-orders',
      action: 'create',
      target: 'so-1',
      currentUser,
      after: { orderTitle: 'X', customerId: 'cust-uuid-2' },
    });
    expect(log.mock.calls[0]![0].targetCustomerId).toBe('cust-uuid-2');
  });

  it('update 时 after 没 customerId 但 before 有 → 用 before.customerId', async () => {
    const { service, log } = mkService();
    await service.logChange({
      module: 'payments',
      action: 'update',
      target: 'pay-1',
      currentUser,
      before: { customerId: 'cust-uuid-3', paymentAmount: 1000 },
      after: { paymentAmount: 2000 }, // 没显式传 customerId
    });
    expect(log.mock.calls[0]![0].targetCustomerId).toBe('cust-uuid-3');
  });

  it('non-CRM module（无 customerId） → null', async () => {
    const { service, log } = mkService();
    await service.logChange({
      module: 'crm-products',
      action: 'create',
      target: 'prod-1',
      currentUser,
      after: { productName: 'X' },
    });
    expect(log.mock.calls[0]![0].targetCustomerId).toBeNull();
  });

  it('after.customerId 非字符串 → null（防御）', async () => {
    const { service, log } = mkService();
    await service.logChange({
      module: 'contacts',
      action: 'update',
      target: 'contact-1',
      currentUser,
      before: { contactName: 'a' },
      after: { contactName: 'b', customerId: null },
    });
    expect(log.mock.calls[0]![0].targetCustomerId).toBeNull();
  });

  it('action=update 但无字段变化 → 不调用 log（沿用原行为）', async () => {
    const { service, log } = mkService();
    await service.logChange({
      module: 'sale-orders',
      action: 'update',
      target: 'so-1',
      currentUser,
      before: { orderTitle: 'X', customerId: 'cust-1' },
      after: { orderTitle: 'X', customerId: 'cust-1' },
    });
    expect(log).not.toHaveBeenCalled();
  });
});
