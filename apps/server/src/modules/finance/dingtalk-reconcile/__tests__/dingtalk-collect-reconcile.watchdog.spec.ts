import { ConfigService } from '@nestjs/config';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  asPrismaService,
  createMockPrismaService,
  type MockPrismaService,
} from '../../../../test/prisma-mock.factory';
import type { DingtalkMessengerService } from '../../../dingtalk-messenger/dingtalk-messenger.service';
import type { DingtalkCollectReconcileService } from '../dingtalk-collect-reconcile.service';
import { DingtalkCollectReconcileWatchdog } from '../dingtalk-collect-reconcile.watchdog';

/**
 * DingtalkCollectReconcileWatchdog 单测（绑定方案 v2.2 Phase 7）
 *
 * 覆盖：
 *  1. 无 dingtalk_collect 数据（$queryRaw 返回 max_month=null）→ 跳过，不调任何
 *  2. checkMonth.rateOk=true → 静默，不写 OperationLog，不发钉钉
 *  3. checkMonth.rateOk=false + env 配置 → 写 OperationLog + 发钉钉
 *  4. checkMonth.rateOk=false + env 未配置 → 写 OperationLog，不发钉钉
 *  5. 钉钉发送抛错 → cron 不挂
 *  6. resolveLastMonthFromData 跨年回退（2026-01 → 2025-12）
 *  7. checkMonth 抛错 → cron 不挂
 */
describe('DingtalkCollectReconcileWatchdog (v2.2 Phase 7)', () => {
  let watchdog: DingtalkCollectReconcileWatchdog;
  let mockPrisma: MockPrismaService;
  let mockService: { checkMonth: ReturnType<typeof vi.fn> };
  let mockDingtalk: { sendActionCardToUsers: ReturnType<typeof vi.fn> };
  let mockConfig: { get: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    mockPrisma = createMockPrismaService();
    mockService = { checkMonth: vi.fn() };
    mockDingtalk = { sendActionCardToUsers: vi.fn().mockResolvedValue(undefined) };
    mockConfig = { get: vi.fn() };

    watchdog = new DingtalkCollectReconcileWatchdog(
      mockService as unknown as DingtalkCollectReconcileService,
      asPrismaService(mockPrisma),
      mockDingtalk as unknown as DingtalkMessengerService,
      mockConfig as unknown as ConfigService
    );
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('1. 无 dingtalk_collect 数据 → 跳过', async () => {
    mockPrisma.$queryRaw.mockResolvedValue([{ max_month: null }]);

    await watchdog.handleMonthlyAudit();

    expect(mockService.checkMonth).not.toHaveBeenCalled();
    expect(mockPrisma.operationLog.create).not.toHaveBeenCalled();
    expect(mockDingtalk.sendActionCardToUsers).not.toHaveBeenCalled();
  });

  it('2. rateOk=true → 静默', async () => {
    mockPrisma.$queryRaw.mockResolvedValue([{ max_month: '2026-06' }]);
    mockService.checkMonth.mockResolvedValue({
      rateOk: true,
      reason: '在合理区间',
      row: {
        month: '2026-05',
        collectTotal: '100000.00',
        collectCount: 25,
        commissionReceived: '8000.00',
        commissionRate: 0.08,
      },
    });

    await watchdog.handleMonthlyAudit();

    expect(mockService.checkMonth).toHaveBeenCalledWith('2026-05');
    expect(mockPrisma.operationLog.create).not.toHaveBeenCalled();
    expect(mockDingtalk.sendActionCardToUsers).not.toHaveBeenCalled();
  });

  it('3. rateOk=false + env 配置 → 写 OperationLog + 发钉钉', async () => {
    mockPrisma.$queryRaw.mockResolvedValue([{ max_month: '2026-06' }]);
    mockService.checkMonth.mockResolvedValue({
      rateOk: false,
      reason: '返佣率 3.50% 低于 5%，可能漏算佣金 ledger',
      row: {
        month: '2026-05',
        collectTotal: '100000.00',
        collectCount: 25,
        commissionReceived: '3500.00',
        commissionRate: 0.035,
      },
    });
    mockConfig.get.mockReturnValue('dt-user-1001');

    await watchdog.handleMonthlyAudit();

    expect(mockPrisma.operationLog.create).toHaveBeenCalledOnce();
    const opLogCall = mockPrisma.operationLog.create.mock.calls[0]![0];
    expect(opLogCall.data.target).toBe('dingtalk-collect-rate-out-of-bounds');

    expect(mockDingtalk.sendActionCardToUsers).toHaveBeenCalledOnce();
    const dtCall = mockDingtalk.sendActionCardToUsers.mock.calls[0]![0];
    expect(dtCall.dingtalkUserIds).toEqual(['dt-user-1001']);
    expect(dtCall.title).toContain('2026-05');
    expect(dtCall.markdown).toContain('3.50%');
    expect(dtCall.markdown).toContain('100000.00');
  });

  it('4. rateOk=false + env 未配置 → 写 OperationLog，不发钉钉', async () => {
    mockPrisma.$queryRaw.mockResolvedValue([{ max_month: '2026-06' }]);
    mockService.checkMonth.mockResolvedValue({
      rateOk: false,
      reason: '低于阈值',
      row: {
        month: '2026-05',
        collectTotal: '100000.00',
        collectCount: 25,
        commissionReceived: '3500.00',
        commissionRate: 0.035,
      },
    });
    mockConfig.get.mockReturnValue(undefined);

    await watchdog.handleMonthlyAudit();

    expect(mockPrisma.operationLog.create).toHaveBeenCalledOnce();
    expect(mockDingtalk.sendActionCardToUsers).not.toHaveBeenCalled();
  });

  it('5. 钉钉发送抛错 → cron 不挂', async () => {
    mockPrisma.$queryRaw.mockResolvedValue([{ max_month: '2026-06' }]);
    mockService.checkMonth.mockResolvedValue({
      rateOk: false,
      reason: '低于阈值',
      row: {
        month: '2026-05',
        collectTotal: '100000.00',
        collectCount: 25,
        commissionReceived: '3500.00',
        commissionRate: 0.035,
      },
    });
    mockConfig.get.mockReturnValue('dt-user-1001');
    mockDingtalk.sendActionCardToUsers.mockRejectedValue(new Error('钉钉超时'));

    await expect(watchdog.handleMonthlyAudit()).resolves.toBeUndefined();
    expect(mockPrisma.operationLog.create).toHaveBeenCalledOnce();
  });

  it('6. resolveLastMonthFromData 跨年回退：2026-01 → 2025-12', async () => {
    mockPrisma.$queryRaw.mockResolvedValue([{ max_month: '2026-01' }]);
    mockService.checkMonth.mockResolvedValue({
      rateOk: true,
      reason: '在合理区间',
      row: null,
    });

    await watchdog.handleMonthlyAudit();

    expect(mockService.checkMonth).toHaveBeenCalledWith('2025-12');
  });

  it('7. checkMonth 抛错 → cron 不挂', async () => {
    mockPrisma.$queryRaw.mockResolvedValue([{ max_month: '2026-06' }]);
    mockService.checkMonth.mockRejectedValue(new Error('对账 SQL 失败'));

    await expect(watchdog.handleMonthlyAudit()).resolves.toBeUndefined();
    expect(mockPrisma.operationLog.create).not.toHaveBeenCalled();
    expect(mockDingtalk.sendActionCardToUsers).not.toHaveBeenCalled();
  });

  it('8. row.commissionRate === null + rateOk=false → markdown 含 N/A', async () => {
    mockPrisma.$queryRaw.mockResolvedValue([{ max_month: '2026-06' }]);
    mockService.checkMonth.mockResolvedValue({
      rateOk: false,
      reason: '收入异常但 collectTotal=0 无法算 rate',
      row: {
        month: '2026-05',
        collectTotal: '0.00',
        collectCount: 0,
        commissionReceived: '1000.00',
        commissionRate: null,
      },
    });
    mockConfig.get.mockReturnValue('u1');

    await watchdog.handleMonthlyAudit();

    const md = mockDingtalk.sendActionCardToUsers.mock.calls[0]![0].markdown as string;
    expect(md).toContain('N/A');
  });
});
