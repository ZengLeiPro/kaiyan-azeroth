import { describe, expect, it, vi } from 'vitest';

import { AnalyticsOverviewService } from './analytics-overview.service';

function buildService() {
  const prisma = {
    customer: { count: vi.fn() },
    payment: { aggregate: vi.fn() },
    saleOrder: { aggregate: vi.fn() },
    project: { count: vi.fn() },
    effortRecord: { aggregate: vi.fn() },
    keepRecord: { count: vi.fn() },
    loginLog: { findMany: vi.fn() },
    approvalTask: { count: vi.fn() },
  };
  const crm = { getFunnel: vi.fn() };
  const projects = { getEffort: vi.fn() };

  return {
    service: new AnalyticsOverviewService(
      prisma as unknown as ConstructorParameters<typeof AnalyticsOverviewService>[0],
      crm as unknown as ConstructorParameters<typeof AnalyticsOverviewService>[1],
      projects as unknown as ConstructorParameters<typeof AnalyticsOverviewService>[2]
    ),
    prisma,
    crm,
    projects,
  };
}

const customRange = { preset: 'custom', startDate: '2026-06-01', endDate: '2026-06-30' } as const;

describe('AnalyticsOverviewService', () => {
  it('getOverview 的 paymentAmount 以 IN-OUT 计算净回款', async () => {
    const { service, prisma, crm, projects } = buildService();
    prisma.customer.count.mockResolvedValueOnce(2).mockResolvedValueOnce(0);
    prisma.payment.aggregate
      .mockResolvedValueOnce({ _sum: { paymentAmount: { toNumber: () => 100.129 } } })
      .mockResolvedValueOnce({ _sum: { paymentAmount: { toNumber: () => 20.123 } } });
    prisma.saleOrder.aggregate.mockResolvedValue({ _sum: { orderAmount: 50 } });
    prisma.project.count.mockResolvedValueOnce(1).mockResolvedValueOnce(0);
    prisma.effortRecord.aggregate.mockResolvedValue({ _sum: { actualTime: 8 } });
    prisma.keepRecord.count.mockResolvedValue(3);
    prisma.loginLog.findMany.mockResolvedValue([]);
    prisma.approvalTask.count.mockResolvedValue(0);
    crm.getFunnel.mockResolvedValue({ stages: [] });
    projects.getEffort.mockResolvedValue({ byProject: [] });

    const result = await service.getOverview(customRange, null);

    expect(result.kpis.paymentAmount).toBe(80.01);
    expect(prisma.payment.aggregate).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: expect.objectContaining({ flowStatus: 'approved', direction: 'IN' }),
      })
    );
    expect(prisma.payment.aggregate).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: expect.objectContaining({ flowStatus: 'approved', direction: 'OUT' }),
      })
    );
  });
});
