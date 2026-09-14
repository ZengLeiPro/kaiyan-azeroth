import { vi } from 'vitest';

import {
  asPrismaService,
  createMockPrismaService,
  type MockPrismaService,
} from '../../../../test/prisma-mock.factory';
import { FinancePnlService } from '../pnl.service';

describe('FinancePnlService', () => {
  let prisma: MockPrismaService;
  let service: FinancePnlService;

  beforeEach(() => {
    prisma = createMockPrismaService();
    service = new FinancePnlService(asPrismaService(prisma));
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('getPnl 将叶子科目金额滚到父级分组行，且总计不重复计算分组行', async () => {
    prisma.$queryRaw.mockResolvedValue([
      {
        subject_id: 'leaf-custom',
        subject_code: 'revenue.service_custom',
        subject_name: '定制开发收入',
        category: 'revenue',
        level: 2,
        parent_code: 'revenue.service',
        display_order: 110,
        month: 1,
        total: '100.00',
      },
      {
        subject_id: 'leaf-custom',
        subject_code: 'revenue.service_custom',
        subject_name: '定制开发收入',
        category: 'revenue',
        level: 2,
        parent_code: 'revenue.service',
        display_order: 110,
        month: 2,
        total: '50.00',
      },
      {
        subject_id: 'leaf-dingtalk-cogs',
        subject_code: 'cogs.resale_dingtalk',
        subject_name: '钉钉代付成本',
        category: 'cogs',
        level: 2,
        parent_code: 'cogs.resale',
        display_order: 180,
        month: 1,
        total: '-30.00',
      },
    ]);
    prisma.financeSubject.findMany.mockResolvedValue([
      {
        id: 'group-service',
        code: 'revenue.service',
        name: '技术服务收入',
        category: 'revenue',
        level: 1,
        parentId: null,
        parent: null,
        displayOrder: 100,
      },
      {
        id: 'leaf-custom',
        code: 'revenue.service_custom',
        name: '定制开发收入',
        category: 'revenue',
        level: 2,
        parentId: 'group-service',
        parent: { code: 'revenue.service' },
        displayOrder: 110,
      },
      {
        id: 'group-cogs',
        code: 'cogs.resale',
        name: '业务转售成本',
        category: 'cogs',
        level: 1,
        parentId: null,
        parent: null,
        displayOrder: 170,
      },
      {
        id: 'leaf-dingtalk-cogs',
        code: 'cogs.resale_dingtalk',
        name: '钉钉代付成本',
        category: 'cogs',
        level: 2,
        parentId: 'group-cogs',
        parent: { code: 'cogs.resale' },
        displayOrder: 180,
      },
    ]);

    const result = await service.getPnl({ year: 2026 });

    expect(result.subjects.map((s) => s.subjectCode)).toEqual([
      'revenue.service',
      'revenue.service_custom',
      'cogs.resale',
      'cogs.resale_dingtalk',
    ]);

    const serviceGroup = result.subjects.find((s) => s.subjectCode === 'revenue.service');
    const serviceLeaf = result.subjects.find((s) => s.subjectCode === 'revenue.service_custom');
    const cogsGroup = result.subjects.find((s) => s.subjectCode === 'cogs.resale');

    expect(serviceGroup).toMatchObject({
      level: 1,
      total: 150,
      months: expect.objectContaining({ 1: 100, 2: 50 }),
    });
    expect(serviceLeaf).toMatchObject({
      level: 2,
      parentCode: 'revenue.service',
      total: 150,
    });
    expect(cogsGroup).toMatchObject({
      level: 1,
      total: -30,
      months: expect.objectContaining({ 1: -30 }),
    });

    expect(result.categoryTotals).toMatchObject({ revenue: 150, cogs: -30 });
    expect(result.grandTotals).toMatchObject({
      revenue: 150,
      cogs: -30,
      grossProfit: 120,
    });
  });
});
