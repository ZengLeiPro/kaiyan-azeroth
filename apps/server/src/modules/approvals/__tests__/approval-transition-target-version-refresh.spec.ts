import { APPROVAL_EVENT_TYPE } from '@ky-azeroth/shared/constants';

import { asPrismaService, createMockPrismaService } from '../../../test/prisma-mock.factory';
import { ApprovalTransitionEngine } from '../approval-transition.engine';

describe('ApprovalTransitionEngine 审批目标版本自愈', () => {
  it('审批中的旧合同订单审批使用订单当前版本刷新快照', async () => {
    const prisma = createMockPrismaService();
    prisma.saleOrder.findFirst.mockResolvedValue({ version: 4 });
    prisma.approvalInstance.updateMany.mockResolvedValue({ count: 1 });
    const engine = new ApprovalTransitionEngine(
      asPrismaService(prisma),
      {} as never,
      {} as never,
      {} as never
    );
    const instance = {
      id: 'approval-1',
      eventType: APPROVAL_EVENT_TYPE.SALE_ORDER_ACTIVATE,
      formId: 'sale-order-1',
      targetVersion: 3,
      version: 7,
    };

    await expect(
      (
        engine as never as {
          refreshStalePendingSaleOrderTargetVersion: (
            tx: unknown,
            value: unknown,
            user: unknown
          ) => Promise<unknown>;
        }
      ).refreshStalePendingSaleOrderTargetVersion(prisma, instance, { id: 'user-1' })
    ).resolves.toMatchObject({ targetVersion: 4, version: 8 });

    expect(prisma.approvalInstance.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 'approval-1', targetVersion: 3, version: 7 }),
        data: expect.objectContaining({ targetVersion: 4, version: { increment: 1 } }),
      })
    );
  });

  it('当前版本未前进或非合同订单审批时不改写审批实例', async () => {
    const prisma = createMockPrismaService();
    prisma.saleOrder.findFirst.mockResolvedValue({ version: 3 });
    const engine = new ApprovalTransitionEngine(
      asPrismaService(prisma),
      {} as never,
      {} as never,
      {} as never
    );
    const instance = {
      id: 'approval-1',
      eventType: APPROVAL_EVENT_TYPE.SALE_ORDER_ACTIVATE,
      formId: 'sale-order-1',
      targetVersion: 3,
      version: 7,
    };

    await (
      engine as never as {
        refreshStalePendingSaleOrderTargetVersion: (
          tx: unknown,
          value: unknown,
          user: unknown
        ) => Promise<unknown>;
      }
    ).refreshStalePendingSaleOrderTargetVersion(prisma, instance, { id: 'user-1' });

    expect(prisma.approvalInstance.updateMany).not.toHaveBeenCalled();
    expect(vi.isMockFunction(prisma.saleOrder.findFirst)).toBe(true);
  });
});
