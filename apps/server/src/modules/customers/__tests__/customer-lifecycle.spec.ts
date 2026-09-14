import { CONTACT_STATUS, DEAL_STATUS, LEAD_PROGRESS_STATUS } from '@ky-azeroth/shared/constants';
import { ConflictException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { beforeEach, describe, expect, it } from 'vitest';

import { createMockPrismaService, type MockPrismaService } from '../../../test/prisma-mock.factory';
import { recomputeCustomerLifecycle } from '../customer-lifecycle';

const BASE_TIME = new Date('2026-08-20T08:00:00.000Z');

function lifecycleCustomer(overrides: Record<string, unknown> = {}) {
  return {
    id: 'cust-1',
    version: 4,
    contactStatus: CONTACT_STATUS.UNTOUCHED,
    dealStatus: DEAL_STATUS.NOT_WON,
    lastKeepRecordTime: null,
    lastKeepRecordContent: null,
    leadStage: 'MQL',
    leadStageUpdatedAt: BASE_TIME,
    leadStageUpdatedById: 'emp-old',
    leadStageQualifiedAt: BASE_TIME,
    leadStageQualifiedById: 'emp-old',
    firstSqlAt: null,
    leadProgressStatus: LEAD_PROGRESS_STATUS.ACTIVE,
    leadProgressUpdatedAt: BASE_TIME,
    leadAppointmentAt: null,
    leadProgressReason: null,
    leadProgressUpdatedById: 'emp-old',
    intentTemperature: 'UNJUDGED',
    intentReasons: null,
    nextFollowUpAt: null,
    intentUpdatedAt: null,
    intentUpdatedById: null,
    intentSourceKeepRecordId: null,
    updaterEmployeeId: 'emp-old',
    ...overrides,
  };
}

describe('recomputeCustomerLifecycle', () => {
  let tx: MockPrismaService;

  beforeEach(() => {
    tx = createMockPrismaService();
    tx.$queryRaw.mockResolvedValue([]);
    tx.customer.findFirst.mockResolvedValue(lifecycleCustomer());
    tx.keepRecord.findFirst.mockResolvedValue(null);
    tx.visitRecord.findFirst.mockResolvedValue(null);
    tx.opportunity.count.mockResolvedValue(0);
    tx.opportunity.findFirst.mockResolvedValue(null);
    tx.customer.updateMany.mockResolvedValue({ count: 1 });
  });

  it('按固定 id 顺序取得行锁，随后才读取 version 与全部派生字段', async () => {
    tx.customer.findFirst.mockResolvedValue(null);

    await recomputeCustomerLifecycle(
      tx as unknown as Prisma.TransactionClient,
      ['cust-b', 'cust-a', 'cust-b'],
      { syncLeadProgress: false }
    );

    expect(tx.$queryRaw).toHaveBeenCalledTimes(2);
    expect(tx.$queryRaw.mock.calls.map((call) => call[1])).toEqual(['cust-a', 'cust-b']);
    expect(tx.$queryRaw.mock.invocationCallOrder[1]).toBeLessThan(
      tx.customer.findFirst.mock.invocationCallOrder[0]!
    );
    expect(tx.customer.findFirst).toHaveBeenCalledWith({
      where: { id: 'cust-a', deletedAt: null },
      select: expect.objectContaining({
        id: true,
        version: true,
        contactStatus: true,
        dealStatus: true,
        lastKeepRecordTime: true,
        lastKeepRecordContent: true,
        leadProgressStatus: true,
        leadProgressReason: true,
        updaterEmployeeId: true,
      }),
    });
  });

  it('所有派生字段相同则不 UPDATE、不改审计也不推进 version', async () => {
    await recomputeCustomerLifecycle(tx as unknown as Prisma.TransactionClient, 'cust-1', {
      syncLeadProgress: true,
      actor: { id: 'user-1', employeeId: 'emp-1' },
    });

    expect(tx.customer.updateMany).not.toHaveBeenCalled();
    expect(tx.keepRecord.create).not.toHaveBeenCalled();
  });

  it('只取最新填写温度的记录，并以实际编辑审计显示意向更新人和时间', async () => {
    const intentRecord = {
      id: 'keep-intent',
      intentTemperature: 'HIGH',
      intentReasons: ['PAIN_POINT', 'DEMO'],
      nextFollowUpAt: new Date('2026-08-23T00:00:00.000Z'),
      // B 是业务负责人，但 A 在今天补录并编辑上周的跟进；客户档案必须显示 A 和今天。
      chargerId: 'emp-responsible-b',
      keepRecordTime: new Date('2026-08-13T12:00:00.000Z'),
      creatorEmployeeId: 'emp-creator-c',
      updaterEmployeeId: 'emp-editor-a',
      createdAt: new Date('2026-08-20T12:05:00.000Z'),
      updatedAt: new Date('2026-08-21T09:30:00.000Z'),
    };
    tx.keepRecord.findFirst.mockImplementation(
      (args: { select?: { intentTemperature?: boolean } }) =>
        Promise.resolve(args.select?.intentTemperature ? intentRecord : null)
    );

    await recomputeCustomerLifecycle(tx as unknown as Prisma.TransactionClient, 'cust-1', {
      syncLeadProgress: false,
      actor: { id: 'user-1', employeeId: 'emp-1' },
    });

    expect(tx.customer.updateMany).toHaveBeenCalledWith({
      where: { id: 'cust-1', version: 4, deletedAt: null },
      data: {
        intentTemperature: 'HIGH',
        intentReasons: ['PAIN_POINT', 'DEMO'],
        nextFollowUpAt: intentRecord.nextFollowUpAt,
        intentUpdatedAt: intentRecord.updatedAt,
        intentUpdatedById: 'emp-editor-a',
        intentSourceKeepRecordId: 'keep-intent',
        updaterEmployeeId: 'emp-1',
        version: { increment: 1 },
      },
    });
  });

  it('无 Leads 字段时仅 contact/deal 真实变化也做一次 id+version CAS 与一次增量', async () => {
    tx.customer.findFirst.mockResolvedValue(
      lifecycleCustomer({ leadStage: null, leadProgressStatus: null })
    );
    tx.keepRecord.findFirst.mockImplementation((args: { select?: { keepRecordType?: boolean } }) =>
      Promise.resolve(
        args.select?.keepRecordType
          ? { keepRecordType: 'phone', createdAt: new Date('2026-08-20T10:00:00.000Z') }
          : null
      )
    );
    tx.opportunity.count.mockResolvedValue(1);

    await recomputeCustomerLifecycle(tx as unknown as Prisma.TransactionClient, 'cust-1', {
      syncLeadProgress: true,
      actor: { id: 'user-1', employeeId: 'emp-1' },
    });

    expect(tx.opportunity.findFirst).not.toHaveBeenCalled();
    expect(tx.customer.updateMany).toHaveBeenCalledTimes(1);
    expect(tx.customer.updateMany).toHaveBeenCalledWith({
      where: { id: 'cust-1', version: 4, deletedAt: null },
      data: {
        contactStatus: CONTACT_STATUS.CALLED,
        dealStatus: DEAL_STATUS.WON,
        updaterEmployeeId: 'emp-1',
        version: { increment: 1 },
      },
    });
  });

  it('approved/legacy NULL 过滤同时约束拜访、跟进与成交事实', async () => {
    tx.visitRecord.findFirst.mockResolvedValue({
      visitType: 'onsite',
      createdAt: new Date('2026-08-20T10:00:00.000Z'),
      signInTime: new Date('2026-08-20T10:00:00.000Z'),
    });

    await recomputeCustomerLifecycle(tx as unknown as Prisma.TransactionClient, 'cust-1', {
      syncLeadProgress: true,
      actor: { id: 'user-1', employeeId: 'emp-1' },
    });

    expect(tx.visitRecord.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          customerId: 'cust-1',
          deletedAt: null,
          OR: [{ flowStatus: 'approved' }, { flowStatus: null }],
        },
      })
    );
    expect(tx.keepRecord.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          customerId: 'cust-1',
          deletedAt: null,
          AND: expect.arrayContaining([{ OR: [{ flowStatus: 'approved' }, { flowStatus: null }] }]),
        }),
      })
    );
    expect(tx.opportunity.count).toHaveBeenCalledWith({
      where: {
        customerId: 'cust-1',
        deletedAt: null,
        opportunityStage: '赢单',
        OR: [{ flowStatus: 'approved' }, { flowStatus: null }],
      },
    });
    expect(tx.customer.updateMany).toHaveBeenCalledWith({
      where: { id: 'cust-1', version: 4, deletedAt: null },
      data: expect.objectContaining({
        contactStatus: CONTACT_STATUS.VISITED,
        leadProgressStatus: LEAD_PROGRESS_STATUS.VISITED,
        updaterEmployeeId: 'emp-1',
        version: { increment: 1 },
      }),
    });
  });

  it('赢单事实一次性同步 deal/Leads/SQL，且系统留底不作为接触事实', async () => {
    tx.opportunity.count.mockResolvedValue(1);
    tx.opportunity.findFirst.mockResolvedValue({
      updatedAt: new Date('2026-08-20T12:00:00.000Z'),
    });

    await recomputeCustomerLifecycle(tx as unknown as Prisma.TransactionClient, 'cust-1', {
      syncLeadProgress: true,
      actor: { id: 'user-1', employeeId: 'emp-1' },
    });

    expect(tx.customer.updateMany).toHaveBeenCalledTimes(1);
    expect(tx.customer.updateMany).toHaveBeenCalledWith({
      where: { id: 'cust-1', version: 4, deletedAt: null },
      data: expect.objectContaining({
        dealStatus: DEAL_STATUS.WON,
        leadProgressStatus: LEAD_PROGRESS_STATUS.WON,
        leadStage: 'SQL',
        leadProgressUpdatedById: 'emp-1',
        leadStageUpdatedById: 'emp-1',
        leadStageQualifiedById: 'emp-1',
        updaterEmployeeId: 'emp-1',
        version: { increment: 1 },
      }),
    });
    expect(tx.keepRecord.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        customerId: 'cust-1',
        chargerId: 'emp-1',
        source: 'field_change',
        creatorEmployeeId: 'emp-1',
        updaterEmployeeId: 'emp-1',
      }),
    });
  });

  it('actor 无有效 employeeId 时绝不猜 actor.id 为 Employee FK', async () => {
    tx.opportunity.count.mockResolvedValue(1);
    tx.opportunity.findFirst.mockResolvedValue({
      updatedAt: new Date('2026-08-20T12:00:00.000Z'),
    });

    await recomputeCustomerLifecycle(tx as unknown as Prisma.TransactionClient, 'cust-1', {
      syncLeadProgress: true,
      actor: { id: 'user-not-an-employee' },
    });

    const data = tx.customer.updateMany.mock.calls[0]?.[0]?.data;
    expect(data).toEqual(
      expect.objectContaining({
        leadProgressUpdatedById: null,
        leadStageUpdatedById: null,
        leadStageQualifiedById: null,
        updaterEmployeeId: null,
      })
    );
    expect(JSON.stringify(data)).not.toContain('user-not-an-employee');
    expect(tx.keepRecord.create).not.toHaveBeenCalled();
  });

  it('field_change 系统跟进永不成为联系、最近跟进或线上演示事实', async () => {
    const fieldChangeKeep = {
      keepRecordType: 'online_demo',
      createdAt: new Date('2026-08-20T10:00:00.000Z'),
      keepRecordTime: new Date('2026-08-20T10:00:00.000Z'),
      keepRecordContent: '[系统] 线索阶段变更',
    };
    tx.keepRecord.findFirst.mockImplementation(
      (args: { where?: { AND?: Array<{ OR?: Array<{ source?: null | { not?: string } }> }> } }) => {
        const excludesFieldChange = args.where?.AND?.some((group) =>
          group.OR?.some(
            (item) => typeof item.source === 'object' && item.source?.not === 'field_change'
          )
        );
        return Promise.resolve(excludesFieldChange ? null : fieldChangeKeep);
      }
    );

    await recomputeCustomerLifecycle(tx as unknown as Prisma.TransactionClient, 'cust-1', {
      syncLeadProgress: true,
      actor: { id: 'user-1', employeeId: 'emp-1' },
    });

    expect(tx.customer.updateMany).not.toHaveBeenCalled();
  });

  it('新旧客户改绑时锁定去重后的两端，并分别基于各自行锁后版本更新', async () => {
    tx.customer.findFirst.mockImplementation((args: { where: { id: string } }) =>
      Promise.resolve(
        lifecycleCustomer({
          id: args.where.id,
          version: args.where.id === 'cust-new' ? 8 : 3,
          contactStatus: null,
        })
      )
    );

    await recomputeCustomerLifecycle(
      tx as unknown as Prisma.TransactionClient,
      ['cust-old', 'cust-new', 'cust-old'],
      { syncLeadProgress: false, actor: { id: 'user-1', employeeId: 'emp-1' } }
    );

    expect(tx.$queryRaw.mock.calls.map((call) => call[1])).toEqual(['cust-new', 'cust-old']);
    expect(tx.customer.updateMany).toHaveBeenCalledTimes(2);
    expect(tx.customer.updateMany.mock.calls.map((call) => call[0].where)).toEqual([
      { id: 'cust-new', version: 8, deletedAt: null },
      { id: 'cust-old', version: 3, deletedAt: null },
    ]);
    for (const call of tx.customer.updateMany.mock.calls) {
      expect(call[0].data.version).toEqual({ increment: 1 });
    }
  });

  it('restore 复合操作 preserve-version 模式只做派生 CAS，不产生第二次增量', async () => {
    tx.customer.findFirst.mockResolvedValue(
      lifecycleCustomer({
        version: 6,
        contactStatus: null,
        leadStage: null,
        leadProgressStatus: null,
      })
    );

    await recomputeCustomerLifecycle(tx as unknown as Prisma.TransactionClient, 'cust-1', {
      syncLeadProgress: true,
      actor: { id: 'user-1', employeeId: 'emp-1' },
      versioning: { mode: 'preserve', expectedVersion: 6 },
    });

    expect(tx.customer.updateMany).toHaveBeenCalledWith({
      where: { id: 'cust-1', version: 6, deletedAt: null },
      data: {
        contactStatus: CONTACT_STATUS.UNTOUCHED,
        updaterEmployeeId: 'emp-1',
      },
    });
  });

  it('preserve-version 必须匹配复合主写后的精确版本', async () => {
    tx.customer.findFirst.mockResolvedValue(lifecycleCustomer({ version: 7 }));

    await expect(
      recomputeCustomerLifecycle(tx as unknown as Prisma.TransactionClient, 'cust-1', {
        syncLeadProgress: false,
        versioning: { mode: 'preserve', expectedVersion: 6 },
      })
    ).rejects.toBeInstanceOf(ConflictException);
    expect(tx.keepRecord.findFirst).not.toHaveBeenCalled();
    expect(tx.customer.updateMany).not.toHaveBeenCalled();
  });

  it('最终 CAS count 漂移统一抛 409', async () => {
    tx.customer.findFirst.mockResolvedValue(lifecycleCustomer({ contactStatus: null }));
    tx.customer.updateMany.mockResolvedValue({ count: 0 });

    await expect(
      recomputeCustomerLifecycle(tx as unknown as Prisma.TransactionClient, 'cust-1', {
        syncLeadProgress: false,
      })
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
