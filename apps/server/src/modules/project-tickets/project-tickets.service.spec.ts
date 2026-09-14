import {
  PROJECT_TICKET_PRIORITY,
  PROJECT_TICKET_STATUS,
  PROJECT_TICKET_TYPE,
} from '@ky-azeroth/shared/constants';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CurrentUserType } from '../auth/decorators/current-user.decorator';
import { ProjectTicketsService } from './project-tickets.service';

type ProjectTicketDelegate = ConstructorParameters<
  typeof ProjectTicketsService
>[0]['projectTicket'];

type MockProjectTicketDelegate = {
  [K in keyof Pick<
    ProjectTicketDelegate,
    'create' | 'findFirst' | 'findMany' | 'count' | 'update'
  >]: ReturnType<typeof vi.fn>;
};

function buildPrisma() {
  return {
    projectTicket: {
      create: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      update: vi.fn(),
    } satisfies MockProjectTicketDelegate,
  };
}

function buildService() {
  const prisma = buildPrisma();
  const serialNumberService = { generate: vi.fn().mockResolvedValue('PT-0001') };
  const notificationsService = { create: vi.fn().mockResolvedValue({ id: 'n-1' }) };
  const filterApplier = {
    buildWhere: vi.fn(async ({ baseWhere }: { baseWhere: unknown }) => baseWhere),
  };
  const dataScope = {
    resolveChargerScope: vi.fn(
      async (
        userId: string,
        roles: string[],
        _module: string,
        _menu: string,
        options?: { employeeId?: string }
      ) => (roles?.includes('ADMIN') ? null : [options?.employeeId ?? userId])
    ),
  };
  const service = new ProjectTicketsService(
    prisma as unknown as ConstructorParameters<typeof ProjectTicketsService>[0],
    serialNumberService as unknown as ConstructorParameters<typeof ProjectTicketsService>[1],
    notificationsService as unknown as ConstructorParameters<typeof ProjectTicketsService>[2],
    filterApplier as unknown as ConstructorParameters<typeof ProjectTicketsService>[3],
    dataScope as unknown as ConstructorParameters<typeof ProjectTicketsService>[4]
  );
  return { service, prisma, serialNumberService, notificationsService, filterApplier, dataScope };
}

const adminUser: CurrentUserType = {
  id: 'emp-admin',
  username: 'admin',
  roles: ['ADMIN'],
  employeeId: 'emp-admin',
};

const dispatcherUser: CurrentUserType = {
  id: 'emp-dispatcher',
  username: 'dispatcher',
  roles: [],
  employeeId: 'emp-dispatcher',
};

const assigneeUser: CurrentUserType = {
  id: 'emp-assignee',
  username: 'assignee',
  roles: [],
  employeeId: 'emp-assignee',
};

function buildTicket(overrides: Record<string, unknown> = {}) {
  const now = new Date('2026-06-01T00:00:00Z');
  return {
    id: 'ticket-1',
    ticketNo: 'PT-0001',
    projectId: 'project-1',
    title: '工单标题',
    description: '描述',
    ticketType: PROJECT_TICKET_TYPE.REQUIREMENT,
    priority: PROJECT_TICKET_PRIORITY.MEDIUM,
    status: PROJECT_TICKET_STATUS.PENDING,
    dispatcherId: 'emp-dispatcher',
    assigneeId: 'emp-assignee',
    dueDate: new Date('2026-06-10T00:00:00Z'),
    startedAt: null,
    completedAt: null,
    closedAt: null,
    cancelledAt: null,
    completionNote: null,
    closeNote: null,
    cancelReason: null,
    attachments: [],
    deletedAt: null,
    createdAt: now,
    updatedAt: now,
    version: 1,
    createdBy: 'emp-dispatcher',
    updatedBy: 'emp-dispatcher',
    project: { id: 'project-1', name: '项目 A', customer: { customerName: '客户 A' } },
    dispatcher: { id: 'emp-dispatcher', name: '派单人' },
    assignee: { id: 'emp-assignee', name: '接单人' },
    ...overrides,
  };
}

describe('ProjectTicketsService', () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  it('create 使用当前员工派单、生成编号并通知接单人', async () => {
    const { service, prisma, serialNumberService, notificationsService } = buildService();
    prisma.projectTicket.create.mockResolvedValue(buildTicket());

    const result = await service.create(
      {
        projectId: 'project-1',
        title: '工单标题',
        description: '描述',
        ticketType: PROJECT_TICKET_TYPE.REQUIREMENT,
        priority: PROJECT_TICKET_PRIORITY.MEDIUM,
        assigneeId: 'emp-assignee',
        dueDate: '2026-06-10',
        attachments: [
          {
            id: 'att-1',
            name: '需求文档.pdf',
            url: 'https://example.com/a.pdf',
            size: 1024,
            mimeType: 'application/pdf',
          },
        ],
      },
      dispatcherUser
    );

    expect(serialNumberService.generate).toHaveBeenCalledTimes(1);
    expect(prisma.projectTicket.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          ticketNo: 'PT-0001',
          dispatcherId: 'emp-dispatcher',
          status: PROJECT_TICKET_STATUS.PENDING,
        }),
      })
    );
    expect(notificationsService.create).toHaveBeenCalledWith(
      expect.objectContaining({ employeeId: 'emp-assignee' })
    );
    expect(result.ticketNo).toBe('PT-0001');
  });

  it('findAll 对非管理员 ALL 视图限制为本人派出或接收的工单', async () => {
    const { service, prisma, filterApplier } = buildService();
    prisma.projectTicket.count.mockResolvedValue(1);
    prisma.projectTicket.findMany.mockResolvedValue([buildTicket()]);

    const result = await service.findAll(
      { page: 1, pageSize: 20, sortOrder: 'desc', view: 'ALL' },
      assigneeUser
    );

    expect(filterApplier.buildWhere).toHaveBeenCalledWith(
      expect.objectContaining({
        baseWhere: expect.objectContaining({
          deletedAt: null,
          AND: [
            {
              OR: [{ assigneeId: 'emp-assignee' }, { dispatcherId: 'emp-assignee' }],
            },
          ],
        }),
      })
    );
    expect(result.total).toBe(1);
    expect(result.items).toHaveLength(1);
  });

  it('findOne 对不可见工单返回 NotFound，避免泄露存在性', async () => {
    const { service, prisma } = buildService();
    prisma.projectTicket.findFirst.mockResolvedValue(buildTicket());

    await expect(
      service.findOne('ticket-1', {
        id: 'emp-other',
        username: 'other',
        roles: [],
        employeeId: 'emp-other',
      })
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('update 只有派单人或管理员可编辑，并按 version 做乐观锁', async () => {
    const { service, prisma, notificationsService } = buildService();
    prisma.projectTicket.findFirst.mockResolvedValue(buildTicket());
    prisma.projectTicket.update.mockResolvedValue(
      buildTicket({ title: '新标题', assigneeId: 'emp-new' })
    );

    const result = await service.update(
      'ticket-1',
      { title: '新标题', assigneeId: 'emp-new', version: 1 },
      dispatcherUser
    );

    expect(prisma.projectTicket.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'ticket-1', version: 1, deletedAt: null },
        data: expect.objectContaining({ title: '新标题', version: { increment: 1 } }),
      })
    );
    expect(notificationsService.create).toHaveBeenCalledWith(
      expect.objectContaining({ employeeId: 'emp-new' })
    );
    expect(result.title).toBe('新标题');
  });

  it('update 遇到 P2025 转换为 ConflictException', async () => {
    const { service, prisma } = buildService();
    prisma.projectTicket.findFirst.mockResolvedValue(buildTicket());
    prisma.projectTicket.update.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('not found', {
        code: 'P2025',
        clientVersion: 'test',
      })
    );

    await expect(
      service.update('ticket-1', { title: '新标题', version: 0 }, dispatcherUser)
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('transition 拒绝非法状态流转和无权限操作者', async () => {
    const { service, prisma } = buildService();
    prisma.projectTicket.findFirst.mockResolvedValue(
      buildTicket({ status: PROJECT_TICKET_STATUS.CLOSED })
    );

    await expect(
      service.transition(
        'ticket-1',
        { toStatus: PROJECT_TICKET_STATUS.IN_PROGRESS, version: 1 },
        adminUser
      )
    ).rejects.toBeInstanceOf(BadRequestException);

    prisma.projectTicket.findFirst.mockResolvedValue(
      buildTicket({ status: PROJECT_TICKET_STATUS.PENDING })
    );
    await expect(
      service.transition(
        'ticket-1',
        { toStatus: PROJECT_TICKET_STATUS.IN_PROGRESS, version: 1 },
        dispatcherUser
      )
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('transition 允许接单人开始处理并通知派单人', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-02T03:04:05Z'));
    const { service, prisma, notificationsService } = buildService();
    prisma.projectTicket.findFirst.mockResolvedValue(
      buildTicket({ status: PROJECT_TICKET_STATUS.PENDING })
    );
    prisma.projectTicket.update.mockResolvedValue(
      buildTicket({
        status: PROJECT_TICKET_STATUS.IN_PROGRESS,
        startedAt: new Date('2026-06-02T03:04:05Z'),
      })
    );

    const result = await service.transition(
      'ticket-1',
      { toStatus: PROJECT_TICKET_STATUS.IN_PROGRESS, version: 1 },
      assigneeUser
    );

    expect(prisma.projectTicket.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 'ticket-1',
          status: PROJECT_TICKET_STATUS.PENDING,
          version: 1,
          deletedAt: null,
        },
        data: expect.objectContaining({
          status: PROJECT_TICKET_STATUS.IN_PROGRESS,
          startedAt: new Date('2026-06-02T03:04:05Z'),
          version: { increment: 1 },
        }),
      })
    );
    expect(notificationsService.create).toHaveBeenCalledWith(
      expect.objectContaining({ employeeId: 'emp-dispatcher' })
    );
    expect(result.status).toBe(PROJECT_TICKET_STATUS.IN_PROGRESS);
  });

  it('reassign 只允许派单人或管理员改派活跃工单', async () => {
    const { service, prisma, notificationsService } = buildService();
    prisma.projectTicket.findFirst.mockResolvedValue(buildTicket());
    prisma.projectTicket.update.mockResolvedValue(buildTicket({ assigneeId: 'emp-new' }));

    await service.reassign('ticket-1', { assigneeId: 'emp-new', version: 1 }, dispatcherUser);

    expect(prisma.projectTicket.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'ticket-1', version: 1, deletedAt: null },
        data: expect.objectContaining({ assigneeId: 'emp-new', version: { increment: 1 } }),
      })
    );
    expect(notificationsService.create).toHaveBeenCalledWith(
      expect.objectContaining({ employeeId: 'emp-new' })
    );
  });

  it('transition P2025 后若实际状态已变化则抛 BadRequest，若版本冲突则抛 Conflict', async () => {
    const { service, prisma } = buildService();
    prisma.projectTicket.findFirst
      .mockResolvedValueOnce(buildTicket({ status: PROJECT_TICKET_STATUS.PENDING }))
      .mockResolvedValueOnce({ status: PROJECT_TICKET_STATUS.COMPLETED, version: 2 });
    prisma.projectTicket.update.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('not found', {
        code: 'P2025',
        clientVersion: 'test',
      })
    );

    await expect(
      service.transition(
        'ticket-1',
        { toStatus: PROJECT_TICKET_STATUS.IN_PROGRESS, version: 1 },
        assigneeUser
      )
    ).rejects.toBeInstanceOf(BadRequestException);

    prisma.projectTicket.findFirst
      .mockResolvedValueOnce(buildTicket({ status: PROJECT_TICKET_STATUS.PENDING }))
      .mockResolvedValueOnce({ status: PROJECT_TICKET_STATUS.PENDING, version: 2 });
    prisma.projectTicket.update.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('not found', {
        code: 'P2025',
        clientVersion: 'test',
      })
    );

    await expect(
      service.transition(
        'ticket-1',
        { toStatus: PROJECT_TICKET_STATUS.IN_PROGRESS, version: 1 },
        assigneeUser
      )
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('reassign 拒绝非派单人/非管理员，以及非活跃状态工单', async () => {
    const { service, prisma } = buildService();
    prisma.projectTicket.findFirst.mockResolvedValue(buildTicket());

    await expect(
      service.reassign('ticket-1', { assigneeId: 'emp-new', version: 1 }, assigneeUser)
    ).rejects.toBeInstanceOf(ForbiddenException);

    prisma.projectTicket.findFirst.mockResolvedValue(
      buildTicket({ status: PROJECT_TICKET_STATUS.COMPLETED })
    );
    await expect(
      service.reassign('ticket-1', { assigneeId: 'emp-new', version: 1 }, dispatcherUser)
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('remove 拒绝非派单人/非管理员删除工单', async () => {
    const { service, prisma } = buildService();
    prisma.projectTicket.findFirst.mockResolvedValue(buildTicket());

    await expect(service.remove('ticket-1', 1, assigneeUser)).rejects.toBeInstanceOf(
      ForbiddenException
    );
    expect(prisma.projectTicket.update).not.toHaveBeenCalled();
  });

  it('remove 使用软删除而不是物理删除', async () => {
    const { service, prisma } = buildService();
    prisma.projectTicket.findFirst.mockResolvedValue(buildTicket());
    prisma.projectTicket.update.mockResolvedValue(buildTicket({ deletedAt: new Date() }));

    await expect(service.remove('ticket-1', 1, dispatcherUser)).resolves.toEqual({ success: true });
    expect(prisma.projectTicket.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'ticket-1', version: 1, deletedAt: null },
        data: expect.objectContaining({
          deletedAt: expect.any(Date),
          version: { increment: 1 },
        }),
      })
    );
  });

  it('getStats 对没有 employeeId 的非管理员早返回空统计', async () => {
    const { service, prisma } = buildService();

    const stats = await service.getStats({ id: 'u-1', username: 'guest', roles: [] });

    expect(stats).toEqual({
      pending: 0,
      inProgress: 0,
      completed: 0,
      closed: 0,
      cancelled: 0,
      overdue: 0,
      myTodoCount: 0,
    });
    expect(prisma.projectTicket.count).not.toHaveBeenCalled();
  });
});
