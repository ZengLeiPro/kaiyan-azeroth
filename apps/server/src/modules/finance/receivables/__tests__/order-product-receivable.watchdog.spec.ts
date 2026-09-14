import { ConfigService } from '@nestjs/config';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  asPrismaService,
  createMockPrismaService,
  type MockPrismaService,
} from '../../../../test/prisma-mock.factory';
import type { DingtalkMessengerService } from '../../../dingtalk-messenger/dingtalk-messenger.service';
import type { OrderProductReceivableService } from '../order-product-receivable.service';
import { OrderProductReceivableWatchdog } from '../order-product-receivable.watchdog';

/**
 * OrderProductReceivableWatchdog 单测（绑定方案 v2.2 Phase 7）
 *
 * 覆盖：
 *  1. outOfSync.length === 0 → 静默，不写 OperationLog，不发钉钉
 *  2. outOfSync.length > 0 + env 配置 → 写 OperationLog + 发钉钉
 *  3. outOfSync.length > 0 + env 未配置 → 写 OperationLog，不发钉钉（warn）
 *  4. 钉钉发送抛错 → cron 不挂（异常被吞）
 *  5. auditFullTable 抛错 → cron 不挂（异常被吞）
 *  6. env "a,, b ,c" → 解析为 ['a','b','c']（trim + filter empty）
 */
describe('OrderProductReceivableWatchdog (v2.2 Phase 7)', () => {
  let watchdog: OrderProductReceivableWatchdog;
  let mockPrisma: MockPrismaService;
  let mockService: { auditFullTable: ReturnType<typeof vi.fn> };
  let mockDingtalk: { sendActionCardToUsers: ReturnType<typeof vi.fn> };
  let mockConfig: { get: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    mockPrisma = createMockPrismaService();
    mockService = { auditFullTable: vi.fn() };
    mockDingtalk = { sendActionCardToUsers: vi.fn().mockResolvedValue(undefined) };
    mockConfig = { get: vi.fn() };

    watchdog = new OrderProductReceivableWatchdog(
      mockService as unknown as OrderProductReceivableService,
      asPrismaService(mockPrisma),
      mockDingtalk as unknown as DingtalkMessengerService,
      mockConfig as unknown as ConfigService
    );
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('1. outOfSync.length === 0 → 静默，不写 OperationLog，不发钉钉', async () => {
    mockService.auditFullTable.mockResolvedValue({ checked: 1305, outOfSync: [] });

    await watchdog.handleDailyAudit();

    expect(mockService.auditFullTable).toHaveBeenCalledOnce();
    expect(mockPrisma.operationLog.create).not.toHaveBeenCalled();
    expect(mockDingtalk.sendActionCardToUsers).not.toHaveBeenCalled();
  });

  it('2. outOfSync.length > 0 + env 配置 → 写 OperationLog + 发钉钉', async () => {
    mockService.auditFullTable.mockResolvedValue({
      checked: 1305,
      outOfSync: [
        { orderProductId: 'op-aaaa-1111-2222-3333', cached: '100', computed: '200', delta: '100' },
        { orderProductId: 'op-bbbb-4444-5555-6666', cached: '300', computed: '500', delta: '200' },
      ],
    });
    mockConfig.get.mockReturnValue('dt-user-1001,9876543210');

    await watchdog.handleDailyAudit();

    expect(mockPrisma.operationLog.create).toHaveBeenCalledOnce();
    const opLogCall = mockPrisma.operationLog.create.mock.calls[0]![0];
    expect(opLogCall.data.module).toBe('finance');
    expect(opLogCall.data.target).toBe('order-product-receivable-out-of-sync');

    expect(mockDingtalk.sendActionCardToUsers).toHaveBeenCalledOnce();
    const dtCall = mockDingtalk.sendActionCardToUsers.mock.calls[0]![0];
    expect(dtCall.dingtalkUserIds).toEqual(['dt-user-1001', '9876543210']);
    expect(dtCall.title).toBe('OP.totalReceivedAmount 对账异常');
    expect(dtCall.markdown).toContain('2 行失同步');
    expect(dtCall.markdown).toContain('op-aaaa-'); // 前 8 char prefix
    expect(dtCall.markdown).toContain('op-bbbb-');
    expect(dtCall.singleUrl).toContain('order-product-receivable-out-of-sync');
  });

  it('3. outOfSync.length > 0 + env 未配置 → 写 OperationLog，不发钉钉', async () => {
    mockService.auditFullTable.mockResolvedValue({
      checked: 1305,
      outOfSync: [{ orderProductId: 'op-1', cached: '100', computed: '200', delta: '100' }],
    });
    mockConfig.get.mockReturnValue(undefined); // env 未配置

    await watchdog.handleDailyAudit();

    expect(mockPrisma.operationLog.create).toHaveBeenCalledOnce();
    expect(mockDingtalk.sendActionCardToUsers).not.toHaveBeenCalled();
  });

  it('4. 钉钉发送抛错 → cron 不挂（异常被吞）', async () => {
    mockService.auditFullTable.mockResolvedValue({
      checked: 1305,
      outOfSync: [{ orderProductId: 'op-1', cached: '100', computed: '200', delta: '100' }],
    });
    mockConfig.get.mockReturnValue('dt-user-1001');
    mockDingtalk.sendActionCardToUsers.mockRejectedValue(new Error('钉钉接口超时'));

    // 不应 throw
    await expect(watchdog.handleDailyAudit()).resolves.toBeUndefined();
    expect(mockPrisma.operationLog.create).toHaveBeenCalledOnce();
    expect(mockDingtalk.sendActionCardToUsers).toHaveBeenCalledOnce();
  });

  it('5. auditFullTable 抛错 → cron 不挂（异常被吞）', async () => {
    mockService.auditFullTable.mockRejectedValue(new Error('DB 连接失败'));
    mockConfig.get.mockReturnValue('dt-user-1001');

    await expect(watchdog.handleDailyAudit()).resolves.toBeUndefined();
    expect(mockPrisma.operationLog.create).not.toHaveBeenCalled();
    expect(mockDingtalk.sendActionCardToUsers).not.toHaveBeenCalled();
  });

  it('6. env "a,, b ,c" → 解析为 ["a","b","c"]（trim + filter empty）', async () => {
    mockService.auditFullTable.mockResolvedValue({
      checked: 1305,
      outOfSync: [{ orderProductId: 'op-1', cached: '100', computed: '200', delta: '100' }],
    });
    mockConfig.get.mockReturnValue('a,, b ,c');

    await watchdog.handleDailyAudit();

    expect(mockDingtalk.sendActionCardToUsers).toHaveBeenCalledOnce();
    expect(mockDingtalk.sendActionCardToUsers.mock.calls[0]![0].dingtalkUserIds).toEqual([
      'a',
      'b',
      'c',
    ]);
  });

  it('7. outOfSync 超过 5 条 → markdown 含 overflow 提示', async () => {
    const outOfSync = Array.from({ length: 8 }, (_, i) => ({
      orderProductId: `op-${String(i).padStart(8, '0')}`,
      cached: '100',
      computed: '200',
      delta: '100',
    }));
    mockService.auditFullTable.mockResolvedValue({ checked: 1305, outOfSync });
    mockConfig.get.mockReturnValue('dt-user-1001');

    await watchdog.handleDailyAudit();

    const md = mockDingtalk.sendActionCardToUsers.mock.calls[0]![0].markdown as string;
    expect(md).toContain('8 行失同步');
    expect(md).toContain('剩余 3 条');
  });
});
