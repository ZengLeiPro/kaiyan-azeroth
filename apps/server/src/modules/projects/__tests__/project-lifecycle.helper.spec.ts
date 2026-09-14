import { PROJECT_STATUS } from '@ky-azeroth/shared/constants';
import { Prisma } from '@prisma/client';

import { createMockPrismaService } from '../../../test/prisma-mock.factory';
import {
  advanceCustomDevelopmentProjectFromSaleOrder,
  assertSaleOrderProjectRelationUnchanged,
  ensureCustomDevelopmentProject,
} from '../project-lifecycle.helper';

const user = { id: 'employee-1', employeeId: 'employee-1' };

function asTransactionClient(value: unknown): Prisma.TransactionClient {
  return value as Prisma.TransactionClient;
}

describe('project lifecycle helper', () => {
  it('creates one pending project for a custom-development opportunity', async () => {
    const prisma = createMockPrismaService();
    prisma.project.findUnique.mockResolvedValue(null);
    prisma.project.create.mockResolvedValue({ id: 'project-1' });

    await ensureCustomDevelopmentProject(
      asTransactionClient(prisma),
      {
        opportunityId: 'opportunity-1',
        customerId: 'customer-1',
        ownerId: 'employee-1',
        productNames: ['定制开发'],
      },
      PROJECT_STATUS.OPPORTUNITY,
      user
    );

    expect(prisma.project.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        name: '待定项目',
        status: '商机中',
        category: '定制开发',
        customerId: 'customer-1',
        opportunityId: 'opportunity-1',
        ownerId: 'employee-1',
      }),
    });
  });

  it('advances the same project to contract and attaches the approved order', async () => {
    const prisma = createMockPrismaService();
    prisma.saleOrder.findFirst.mockResolvedValue({
      id: 'order-1',
      opportunity: {
        id: 'opportunity-1',
        customerId: 'customer-1',
        chargerId: 'employee-1',
        deletedAt: null,
        products: [{ productName: '定制开发' }],
      },
    });
    prisma.project.findUnique
      .mockResolvedValueOnce({
        id: 'project-1',
        customerId: 'customer-1',
        opportunityId: 'opportunity-1',
        saleOrderId: null,
        status: '商机中',
      })
      .mockResolvedValueOnce(null);
    prisma.project.update.mockResolvedValue({ id: 'project-1' });

    await advanceCustomDevelopmentProjectFromSaleOrder(
      asTransactionClient(prisma),
      'order-1',
      PROJECT_STATUS.CONTRACT,
      user,
      { createIfMissing: true }
    );

    expect(prisma.project.update).toHaveBeenCalledWith({
      where: { id: 'project-1' },
      data: expect.objectContaining({
        saleOrderId: 'order-1',
        status: '合同中',
        version: { increment: 1 },
      }),
    });
  });

  it('does not downgrade a project that has entered an operator-managed phase', async () => {
    const prisma = createMockPrismaService();
    prisma.project.findUnique
      .mockResolvedValueOnce({
        id: 'project-1',
        customerId: 'customer-1',
        opportunityId: 'opportunity-1',
        saleOrderId: null,
        status: '进行中',
      })
      .mockResolvedValueOnce(null);
    prisma.project.update.mockResolvedValue({ id: 'project-1' });

    await ensureCustomDevelopmentProject(
      asTransactionClient(prisma),
      {
        opportunityId: 'opportunity-1',
        customerId: 'customer-1',
        productNames: ['定制开发'],
        saleOrderId: 'order-1',
      },
      PROJECT_STATUS.NOT_STARTED,
      user
    );

    expect(prisma.project.update).toHaveBeenCalledWith({
      where: { id: 'project-1' },
      data: expect.not.objectContaining({ status: expect.anything() }),
    });
    expect(prisma.project.update).toHaveBeenCalledWith({
      where: { id: 'project-1' },
      data: expect.objectContaining({ saleOrderId: 'order-1' }),
    });
  });

  it('does not advance the first order project when a historical second order emits an event', async () => {
    const prisma = createMockPrismaService();
    prisma.project.findUnique
      .mockResolvedValueOnce({
        id: 'project-1',
        customerId: 'customer-1',
        opportunityId: 'opportunity-1',
        saleOrderId: 'order-old',
        status: '合同中',
      })
      .mockResolvedValueOnce(null);
    prisma.project.update.mockResolvedValue({ id: 'project-1' });

    await ensureCustomDevelopmentProject(
      asTransactionClient(prisma),
      {
        opportunityId: 'opportunity-1',
        customerId: 'customer-1',
        productNames: ['定制开发'],
        saleOrderId: 'order-new',
      },
      PROJECT_STATUS.NOT_STARTED,
      user
    );

    expect(prisma.project.update).not.toHaveBeenCalled();
  });

  it('ignores orders whose opportunity does not contain the exact product', async () => {
    const prisma = createMockPrismaService();
    prisma.saleOrder.findFirst.mockResolvedValue({
      id: 'order-1',
      opportunity: {
        id: 'opportunity-1',
        customerId: 'customer-1',
        chargerId: 'employee-1',
        deletedAt: null,
        products: [],
      },
    });

    await advanceCustomDevelopmentProjectFromSaleOrder(
      asTransactionClient(prisma),
      'order-1',
      PROJECT_STATUS.CONTRACT,
      user,
      { createIfMissing: true }
    );

    expect(prisma.project.create).not.toHaveBeenCalled();
    expect(prisma.project.update).not.toHaveBeenCalled();
  });

  it('does not create a project for a lost custom-development opportunity', async () => {
    const prisma = createMockPrismaService();
    prisma.project.findUnique.mockResolvedValue(null);

    await ensureCustomDevelopmentProject(
      asTransactionClient(prisma),
      {
        opportunityId: 'opportunity-lost',
        customerId: 'customer-1',
        productNames: ['定制开发'],
        opportunityStage: '输单流失',
      },
      PROJECT_STATUS.OPPORTUNITY,
      user
    );

    expect(prisma.project.create).not.toHaveBeenCalled();
    expect(prisma.$executeRaw).toHaveBeenCalledOnce();
  });

  it('marks an opportunity-only project as lost when its opportunity becomes lost', async () => {
    const prisma = createMockPrismaService();
    prisma.project.findUnique.mockResolvedValueOnce({
      id: 'project-1',
      customerId: 'customer-1',
      opportunityId: 'opportunity-1',
      saleOrderId: null,
      status: PROJECT_STATUS.OPPORTUNITY,
    });
    prisma.project.update.mockResolvedValue({ id: 'project-1' });

    await ensureCustomDevelopmentProject(
      asTransactionClient(prisma),
      {
        opportunityId: 'opportunity-1',
        customerId: 'customer-1',
        productNames: ['定制开发'],
        opportunityStage: '输单流失',
      },
      PROJECT_STATUS.OPPORTUNITY,
      user,
      { createIfMissing: false }
    );

    expect(prisma.project.update).toHaveBeenCalledWith({
      where: { id: 'project-1' },
      data: expect.objectContaining({ status: PROJECT_STATUS.LOST }),
    });
  });

  it('does not overwrite an operator-managed project when its opportunity becomes lost', async () => {
    const prisma = createMockPrismaService();
    prisma.project.findUnique.mockResolvedValueOnce({
      id: 'project-1',
      customerId: 'customer-1',
      opportunityId: 'opportunity-1',
      saleOrderId: null,
      status: PROJECT_STATUS.IN_PROGRESS,
    });

    await ensureCustomDevelopmentProject(
      asTransactionClient(prisma),
      {
        opportunityId: 'opportunity-1',
        customerId: 'customer-1',
        productNames: ['定制开发'],
        opportunityStage: '输单流失',
      },
      PROJECT_STATUS.OPPORTUNITY,
      user,
      { createIfMissing: false }
    );

    expect(prisma.project.update).not.toHaveBeenCalled();
  });

  it('reactivates a lost opportunity-only project only for an explicit opportunity reopen', async () => {
    const prisma = createMockPrismaService();
    prisma.project.findUnique.mockResolvedValueOnce({
      id: 'project-1',
      customerId: 'customer-1',
      opportunityId: 'opportunity-1',
      saleOrderId: null,
      status: PROJECT_STATUS.LOST,
    });
    prisma.project.update.mockResolvedValue({ id: 'project-1' });

    await ensureCustomDevelopmentProject(
      asTransactionClient(prisma),
      {
        opportunityId: 'opportunity-1',
        customerId: 'customer-1',
        productNames: ['定制开发'],
        opportunityStage: '解决方案',
      },
      PROJECT_STATUS.OPPORTUNITY,
      user,
      { createIfMissing: false, reactivateLostProject: true }
    );

    expect(prisma.project.update).toHaveBeenCalledWith({
      where: { id: 'project-1' },
      data: expect.objectContaining({ status: PROJECT_STATUS.OPPORTUNITY }),
    });
  });

  it('does not create a project when an approved payment belongs to a historical order', async () => {
    const prisma = createMockPrismaService();
    prisma.saleOrder.findFirst.mockResolvedValue({
      id: 'order-old',
      opportunity: {
        id: 'opportunity-old',
        customerId: 'customer-1',
        chargerId: 'employee-1',
        opportunityStage: '赢单',
        deletedAt: null,
        products: [{ productName: '定制开发' }],
      },
    });
    prisma.project.findUnique.mockResolvedValue(null);

    await advanceCustomDevelopmentProjectFromSaleOrder(
      asTransactionClient(prisma),
      'order-old',
      PROJECT_STATUS.NOT_STARTED,
      user,
      { createIfMissing: false }
    );

    expect(prisma.project.create).not.toHaveBeenCalled();
  });

  it('creates an order-approved project as not started when an approved payment already exists', async () => {
    const prisma = createMockPrismaService();
    prisma.saleOrder.findFirst.mockResolvedValue({
      id: 'order-1',
      opportunity: {
        id: 'opportunity-1',
        customerId: 'customer-1',
        chargerId: 'employee-1',
        opportunityStage: '赢单',
        deletedAt: null,
        products: [{ productName: '定制开发' }],
      },
    });
    prisma.project.findUnique.mockResolvedValue(null);
    prisma.payment.findFirst.mockResolvedValue({ id: 'payment-1' });
    prisma.project.create.mockResolvedValue({ id: 'project-1' });

    await advanceCustomDevelopmentProjectFromSaleOrder(
      asTransactionClient(prisma),
      'order-1',
      PROJECT_STATUS.CONTRACT,
      user,
      { createIfMissing: true }
    );

    expect(prisma.project.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ status: PROJECT_STATUS.NOT_STARTED }),
    });
  });

  it('does not create or advance a project from an order whose opportunity is lost', async () => {
    const prisma = createMockPrismaService();
    prisma.saleOrder.findFirst.mockResolvedValue({
      id: 'order-lost',
      opportunity: {
        id: 'opportunity-lost',
        customerId: 'customer-1',
        chargerId: 'employee-1',
        opportunityStage: '输单流失',
        deletedAt: null,
        products: [{ productName: '定制开发' }],
      },
    });
    prisma.project.findUnique.mockResolvedValue(null);

    await advanceCustomDevelopmentProjectFromSaleOrder(
      asTransactionClient(prisma),
      'order-lost',
      PROJECT_STATUS.CONTRACT,
      user,
      { createIfMissing: true }
    );

    expect(prisma.project.create).not.toHaveBeenCalled();
    expect(prisma.project.update).not.toHaveBeenCalled();
  });

  it('keeps an existing project owner but follows an opportunity customer change before order binding', async () => {
    const prisma = createMockPrismaService();
    prisma.project.findUnique.mockResolvedValueOnce({
      id: 'project-1',
      customerId: 'customer-old',
      opportunityId: 'opportunity-1',
      saleOrderId: null,
      ownerId: 'delivery-owner',
      status: PROJECT_STATUS.OPPORTUNITY,
    });
    prisma.project.update.mockResolvedValue({ id: 'project-1' });

    await ensureCustomDevelopmentProject(
      asTransactionClient(prisma),
      {
        opportunityId: 'opportunity-1',
        customerId: 'customer-new',
        ownerId: 'sales-owner',
        productNames: ['定制开发'],
        opportunityStage: '发现需求',
      },
      PROJECT_STATUS.OPPORTUNITY,
      user
    );

    expect(prisma.project.update).toHaveBeenCalledWith({
      where: { id: 'project-1' },
      data: expect.objectContaining({ customerId: 'customer-new' }),
    });
    expect(prisma.project.update).toHaveBeenCalledWith({
      where: { id: 'project-1' },
      data: expect.not.objectContaining({ ownerId: 'sales-owner' }),
    });
  });

  it('blocks changing an order relation when the order already belongs to a project', async () => {
    const prisma = createMockPrismaService();
    prisma.project.findUnique.mockResolvedValue({
      customerId: 'customer-old',
      opportunityId: 'opportunity-old',
    });

    await expect(
      assertSaleOrderProjectRelationUnchanged(
        asTransactionClient(prisma),
        'order-1',
        'customer-new',
        'opportunity-new'
      )
    ).rejects.toThrow('合同订单已关联项目');
  });

  it('translates a unique-constraint race into a domain conflict', async () => {
    const prisma = createMockPrismaService();
    prisma.project.findUnique.mockResolvedValue(null);
    prisma.project.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('unique conflict', {
        code: 'P2002',
        clientVersion: 'test',
        meta: { target: ['opportunityId'] },
      })
    );

    await expect(
      ensureCustomDevelopmentProject(
        asTransactionClient(prisma),
        {
          opportunityId: 'opportunity-1',
          customerId: 'customer-1',
          productNames: ['定制开发'],
          opportunityStage: '发现需求',
        },
        PROJECT_STATUS.OPPORTUNITY,
        user
      )
    ).rejects.toThrow('该商机或合同订单已关联其他项目');
  });
});
