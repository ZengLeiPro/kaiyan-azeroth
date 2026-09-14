import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { PrismaService } from '../../../common/prisma/prisma.service';

const BASELINE = new Date('2020-01-01T00:00:00.000Z');

describe('Customer related updatedAt database invariant', () => {
  let prisma: PrismaService;
  let sequence = 0;

  const nextSerial = (prefix: string): string => {
    sequence += 1;
    return `${prefix}${sequence.toString().padStart(4, '0')}`;
  };

  const createCustomer = async (name: string) =>
    prisma.customer.create({
      data: {
        serialNumber: nextSerial('CT'),
        customerName: name,
      },
    });

  const resetCustomerClock = async (customerId: string) =>
    prisma.customer.update({
      where: { id: customerId },
      data: { updatedAt: BASELINE },
      select: {
        updatedAt: true,
        version: true,
        updaterEmployeeId: true,
      },
    });

  const expectCustomerTouched = async (
    customerId: string,
    operation: () => Promise<unknown>
  ): Promise<void> => {
    const before = await resetCustomerClock(customerId);
    const operationLogCountBefore = await prisma.operationLog.count();

    await operation();

    const after = await prisma.customer.findUniqueOrThrow({
      where: { id: customerId },
      select: {
        updatedAt: true,
        version: true,
        updaterEmployeeId: true,
      },
    });

    expect(after.updatedAt.getTime()).toBeGreaterThan(before.updatedAt.getTime());
    expect(after.version).toBe(before.version);
    expect(after.updaterEmployeeId).toBe(before.updaterEmployeeId);
    expect(await prisma.operationLog.count()).toBe(operationLogCountBefore);
  };

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    sequence = 0;
    await prisma.cleanDatabase();
  });

  it('keeps all 24 statement-level triggers installed', async () => {
    // @prisma-raw-sql: PostgreSQL 触发器属于数据库元数据，Prisma Client 没有对应查询 API。
    const triggerNames = await prisma.$queryRaw<Array<{ trigger_name: string }>>`
      SELECT trigger_name
      FROM information_schema.triggers
      WHERE event_object_schema = 'public'
        AND event_object_table IN (
          'contacts',
          'keep_records',
          'visit_records',
          'opportunities',
          'sale_orders',
          'payments',
          'invoices',
          'projects'
        )
        AND trigger_name LIKE '%_touch_customer_updated_at_%'
      ORDER BY trigger_name
    `;

    expect(triggerNames).toHaveLength(24);
    expect(new Set(triggerNames.map(({ trigger_name }) => trigger_name)).size).toBe(24);
  });

  it('touches the customer for INSERT, UPDATE and DELETE on every related object', async () => {
    const customer = await createCustomer('八类关联对象客户');
    const financialOrder = await prisma.saleOrder.create({
      data: {
        serialNumber: nextSerial('SO'),
        customerId: customer.id,
      },
    });

    const ids: Record<string, string> = {};
    const insertOperations: Array<[string, () => Promise<unknown>]> = [
      [
        'contact',
        async () => {
          const row = await prisma.contact.create({
            data: { contactName: '联系人', customerId: customer.id },
          });
          ids.contact = row.id;
        },
      ],
      [
        'keepRecord',
        async () => {
          const row = await prisma.keepRecord.create({
            data: { customerId: customer.id, keepRecordContent: '跟进内容' },
          });
          ids.keepRecord = row.id;
        },
      ],
      [
        'visitRecord',
        async () => {
          const row = await prisma.visitRecord.create({
            data: { customerId: customer.id, content: '拜访内容' },
          });
          ids.visitRecord = row.id;
        },
      ],
      [
        'opportunity',
        async () => {
          const row = await prisma.opportunity.create({
            data: {
              serialNumber: nextSerial('OP'),
              opportunityName: '商机',
              customerId: customer.id,
            },
          });
          ids.opportunity = row.id;
        },
      ],
      [
        'saleOrder',
        async () => {
          const row = await prisma.saleOrder.create({
            data: {
              serialNumber: nextSerial('SO'),
              customerId: customer.id,
            },
          });
          ids.saleOrder = row.id;
        },
      ],
      [
        'payment',
        async () => {
          const row = await prisma.payment.create({
            data: {
              serialNumber: nextSerial('PY'),
              subject: '回款',
              saleOrderId: financialOrder.id,
              customerId: customer.id,
              paymentAmount: '100',
            },
          });
          ids.payment = row.id;
        },
      ],
      [
        'invoice',
        async () => {
          const row = await prisma.invoice.create({
            data: {
              serialNumber: nextSerial('IV'),
              subject: '发票',
              saleOrderId: financialOrder.id,
              customerId: customer.id,
              invoiceAmount: '100',
            },
          });
          ids.invoice = row.id;
        },
      ],
      [
        'project',
        async () => {
          const row = await prisma.project.create({
            data: { name: '项目', customerId: customer.id },
          });
          ids.project = row.id;
        },
      ],
    ];

    for (const [, insert] of insertOperations) {
      await expectCustomerTouched(customer.id, insert);
    }

    const updateOperations: Array<() => Promise<unknown>> = [
      () => prisma.contact.update({ where: { id: ids.contact }, data: { remark: '已修改' } }),
      () =>
        prisma.keepRecord.update({
          where: { id: ids.keepRecord },
          data: { keepRecordContent: '已修改' },
        }),
      () =>
        prisma.visitRecord.update({
          where: { id: ids.visitRecord },
          data: { content: '已修改' },
        }),
      () =>
        prisma.opportunity.update({
          where: { id: ids.opportunity },
          data: { remark: '已修改' },
        }),
      () =>
        prisma.saleOrder.update({
          where: { id: ids.saleOrder },
          data: { remark: '已修改' },
        }),
      () => prisma.payment.update({ where: { id: ids.payment }, data: { remark: '已修改' } }),
      () => prisma.invoice.update({ where: { id: ids.invoice }, data: { remark: '已修改' } }),
      () =>
        prisma.project.update({
          where: { id: ids.project },
          data: { description: '已修改' },
        }),
    ];

    for (const update of updateOperations) {
      await expectCustomerTouched(customer.id, update);
    }

    // 先删有外键依赖的回款和发票；目标订单与 financialOrder 相互独立。
    const deleteOperations: Array<() => Promise<unknown>> = [
      () => prisma.payment.delete({ where: { id: ids.payment } }),
      () => prisma.invoice.delete({ where: { id: ids.invoice } }),
      () => prisma.contact.delete({ where: { id: ids.contact } }),
      () => prisma.keepRecord.delete({ where: { id: ids.keepRecord } }),
      () => prisma.visitRecord.delete({ where: { id: ids.visitRecord } }),
      () => prisma.opportunity.delete({ where: { id: ids.opportunity } }),
      () => prisma.saleOrder.delete({ where: { id: ids.saleOrder } }),
      () => prisma.project.delete({ where: { id: ids.project } }),
    ];

    for (const remove of deleteOperations) {
      await expectCustomerTouched(customer.id, remove);
    }
  });

  it('touches both customers when a related object is reassigned', async () => {
    const oldCustomer = await createCustomer('原客户');
    const newCustomer = await createCustomer('新客户');
    const contact = await prisma.contact.create({
      data: { contactName: '待改绑联系人', customerId: oldCustomer.id },
    });

    const oldBefore = await resetCustomerClock(oldCustomer.id);
    const newBefore = await resetCustomerClock(newCustomer.id);

    await prisma.contact.update({
      where: { id: contact.id },
      data: { customerId: newCustomer.id },
    });

    const [oldAfter, newAfter] = await Promise.all([
      prisma.customer.findUniqueOrThrow({ where: { id: oldCustomer.id } }),
      prisma.customer.findUniqueOrThrow({ where: { id: newCustomer.id } }),
    ]);

    expect(oldAfter.updatedAt.getTime()).toBeGreaterThan(oldBefore.updatedAt.getTime());
    expect(newAfter.updatedAt.getTime()).toBeGreaterThan(newBefore.updatedAt.getTime());
    expect(oldAfter.version).toBe(oldBefore.version);
    expect(newAfter.version).toBe(newBefore.version);
  });

  it('handles nullable project ownership in all three directions', async () => {
    const customerA = await createCustomer('项目客户 A');
    const customerB = await createCustomer('项目客户 B');
    const project = await prisma.project.create({ data: { name: '待绑定项目' } });

    await expectCustomerTouched(customerA.id, () =>
      prisma.project.update({
        where: { id: project.id },
        data: { customerId: customerA.id },
      })
    );

    const aBefore = await resetCustomerClock(customerA.id);
    const bBefore = await resetCustomerClock(customerB.id);

    await prisma.project.update({
      where: { id: project.id },
      data: { customerId: customerB.id },
    });

    const [aAfter, bAfter] = await Promise.all([
      prisma.customer.findUniqueOrThrow({ where: { id: customerA.id } }),
      prisma.customer.findUniqueOrThrow({ where: { id: customerB.id } }),
    ]);
    expect(aAfter.updatedAt.getTime()).toBeGreaterThan(aBefore.updatedAt.getTime());
    expect(bAfter.updatedAt.getTime()).toBeGreaterThan(bBefore.updatedAt.getTime());

    await expectCustomerTouched(customerB.id, () =>
      prisma.project.update({
        where: { id: project.id },
        data: { customerId: null },
      })
    );
  });

  it('deduplicates a batch statement and touches every old/new customer', async () => {
    const oldCustomer = await createCustomer('批量迁出客户');
    const newCustomer = await createCustomer('批量迁入客户');

    await prisma.contact.createMany({
      data: Array.from({ length: 200 }, (_, index) => ({
        contactName: `批量联系人${index + 1}`,
        customerId: oldCustomer.id,
      })),
    });

    const oldBefore = await resetCustomerClock(oldCustomer.id);
    const newBefore = await resetCustomerClock(newCustomer.id);

    const result = await prisma.contact.updateMany({
      where: { customerId: oldCustomer.id },
      data: { customerId: newCustomer.id },
    });

    const [oldAfter, newAfter] = await Promise.all([
      prisma.customer.findUniqueOrThrow({ where: { id: oldCustomer.id } }),
      prisma.customer.findUniqueOrThrow({ where: { id: newCustomer.id } }),
    ]);

    expect(result.count).toBe(200);
    expect(oldAfter.updatedAt.getTime()).toBeGreaterThan(oldBefore.updatedAt.getTime());
    expect(newAfter.updatedAt.getTime()).toBeGreaterThan(newBefore.updatedAt.getTime());
    expect(oldAfter.version).toBe(oldBefore.version);
    expect(newAfter.version).toBe(newBefore.version);
  });

  it('locks affected customers in a stable order for concurrent cross-customer batches', async () => {
    const customerA = await createCustomer('并发客户 A');
    const customerB = await createCustomer('并发客户 B');

    await prisma.contact.createMany({
      data: [
        ...Array.from({ length: 100 }, (_, index) => ({
          contactName: `A-${index + 1}`,
          customerId: customerA.id,
          remark: 'group-a',
        })),
        ...Array.from({ length: 100 }, (_, index) => ({
          contactName: `B-${index + 1}`,
          customerId: customerB.id,
          remark: 'group-b',
        })),
      ],
    });

    await Promise.all([
      prisma.$transaction((tx) =>
        tx.contact.updateMany({
          where: { remark: 'group-a' },
          data: { customerId: customerB.id },
        })
      ),
      prisma.$transaction((tx) =>
        tx.contact.updateMany({
          where: { remark: 'group-b' },
          data: { customerId: customerA.id },
        })
      ),
    ]);

    expect(
      await prisma.contact.count({
        where: { customerId: customerA.id, remark: 'group-b' },
      })
    ).toBe(100);
    expect(
      await prisma.contact.count({
        where: { customerId: customerB.id, remark: 'group-a' },
      })
    ).toBe(100);
  });

  it('rolls the customer timestamp back with the related write transaction', async () => {
    const customer = await createCustomer('事务回滚客户');
    const before = await resetCustomerClock(customer.id);

    await expect(
      prisma.$transaction(async (tx) => {
        await tx.contact.create({
          data: { contactName: '回滚联系人', customerId: customer.id },
        });
        throw new Error('force rollback');
      })
    ).rejects.toThrow('force rollback');

    const after = await prisma.customer.findUniqueOrThrow({ where: { id: customer.id } });
    expect(after.updatedAt.getTime()).toBe(before.updatedAt.getTime());
    expect(await prisma.contact.count({ where: { customerId: customer.id } })).toBe(0);
  });

  it('preserves direct and batch Customer @updatedAt behavior', async () => {
    const customerA = await createCustomer('客户主表 A');
    const customerB = await createCustomer('客户主表 B');

    await resetCustomerClock(customerA.id);
    const directlyUpdated = await prisma.customer.update({
      where: { id: customerA.id },
      data: { remark: '客户主表直接修改' },
    });
    expect(directlyUpdated.updatedAt.getTime()).toBeGreaterThan(BASELINE.getTime());

    await Promise.all([resetCustomerClock(customerA.id), resetCustomerClock(customerB.id)]);
    const batchResult = await prisma.customer.updateMany({
      where: { id: { in: [customerA.id, customerB.id] } },
      data: { industry: '批量修改行业' },
    });
    const batchUpdated = await prisma.customer.findMany({
      where: { id: { in: [customerA.id, customerB.id] } },
    });

    expect(batchResult.count).toBe(2);
    expect(batchUpdated).toHaveLength(2);
    expect(batchUpdated.every(({ updatedAt }) => updatedAt.getTime() > BASELINE.getTime())).toBe(
      true
    );
  });

  it('also touches soft-deleted customers', async () => {
    const customer = await createCustomer('软删除客户');
    const contact = await prisma.contact.create({
      data: { contactName: '软删除客户联系人', customerId: customer.id },
    });

    await prisma.customer.update({
      where: { id: customer.id },
      data: { deletedAt: new Date(), updatedAt: BASELINE },
    });

    await expectCustomerTouched(customer.id, () =>
      prisma.contact.update({
        where: { id: contact.id },
        data: { remark: '软删除后仍发生关联修改' },
      })
    );
  });
});
