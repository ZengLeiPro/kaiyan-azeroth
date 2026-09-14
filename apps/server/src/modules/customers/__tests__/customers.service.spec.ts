import { CONTACT_STATUS, DEAL_STATUS } from '@ky-azeroth/shared/constants';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { vi } from 'vitest';

import type { FilterApplierService } from '../../../common/filter-scheme';
import { buildCustomer } from '../../../test/factories';
import {
  asPrismaService,
  createMockPrismaService,
  type MockPrismaService,
} from '../../../test/prisma-mock.factory';
import {
  asSerialNumberService,
  createMockSerialNumberService,
  type MockSerialNumberService,
} from '../../../test/serial-number-mock.factory';
import { BusinessApprovalService } from '../../approvals/business-approval.service';
import { KeepRecordsService } from '../../keep-records/keep-records.service';
import { CustomerLifecycleService } from '../customer-lifecycle.service';
import { CUSTOMER_FILTER_REGISTRY } from '../customers.filter-registry';
import { CustomersService } from '../customers.service';

describe('CustomersService', () => {
  let service: CustomersService;
  let mockPrisma: MockPrismaService;
  let mockSerialNumber: MockSerialNumberService;
  let mockFilterApplier: {
    buildWhere: ReturnType<typeof vi.fn>;
  };
  let mockBusinessApproval: {
    submitChangeApproval: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    mockPrisma = createMockPrismaService();
    mockSerialNumber = createMockSerialNumberService('KH');
    mockFilterApplier = {
      buildWhere: vi.fn().mockResolvedValue({ deletedAt: null }),
    };
    // update 守卫会查 ApprovalChangeRequest 检测 pending CUSTOMER_TAG_CHANGE；
    // 默认无 pending（null），单测按需在 case 内 override。
    mockPrisma.approvalChangeRequest.findFirst.mockResolvedValue(null);
    mockPrisma.customer.updateMany.mockResolvedValue({ count: 1 });
    mockBusinessApproval = {
      submitChangeApproval: vi.fn().mockResolvedValue({ id: 'mock-instance' }),
    };

    service = new CustomersService(
      asPrismaService(mockPrisma),
      asSerialNumberService(mockSerialNumber),
      mockFilterApplier as unknown as FilterApplierService,
      // KeepRecordsService mock：仅 write leadStage 留底用到 create；其余路径未覆盖
      { create: vi.fn().mockResolvedValue({}) } as unknown as KeepRecordsService,
      // BusinessApprovalService mock：仅 submitLeadStageChangeRequest 用到；其余路径未覆盖
      mockBusinessApproval as unknown as BusinessApprovalService,
      new CustomerLifecycleService(asPrismaService(mockPrisma))
    );
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('回访日期和意向更新人响应', () => {
    it('列表复用一次员工批查，回收站也批查去重，均返回纯日期', async () => {
      const customers = [
        {
          ...buildCustomer(),
          nextFollowUpAt: new Date('2026-09-11T00:00:00.000Z'),
          intentUpdatedById: 'emp-intent',
          collaboratorIds: ['emp-collab'],
        },
        {
          ...buildCustomer(),
          nextFollowUpAt: new Date('2026-09-12T00:00:00.000Z'),
          intentUpdatedById: 'emp-intent',
        },
      ];
      mockPrisma.customer.findMany.mockResolvedValue(customers);
      mockPrisma.customer.count.mockResolvedValue(2);
      mockPrisma.employee.findMany.mockResolvedValue([
        { id: 'emp-intent', name: '更新人' },
        { id: 'emp-collab', name: '协作人' },
      ]);
      const query = { page: 1, pageSize: 20, sortOrder: 'desc' as const };
      const list = await service.findAll(query);
      expect(list.items.map((item) => item.nextFollowUpAt)).toEqual(['2026-09-11', '2026-09-12']);
      expect(list.items.map((item) => item.intentUpdatedByName)).toEqual(['更新人', '更新人']);
      expect(list.items[0]?.collaboratorName).toBe('协作人');
      expect(mockPrisma.employee.findMany).toHaveBeenCalledTimes(1);
      expect(mockPrisma.employee.findMany).toHaveBeenCalledWith({
        where: { id: { in: ['emp-intent', 'emp-collab'] } },
        select: { id: true, name: true },
      });
      mockPrisma.employee.findMany.mockClear();
      const trashed = await service.findTrashed(query);
      expect(trashed.items.map((item) => item.nextFollowUpAt)).toEqual([
        '2026-09-11',
        '2026-09-12',
      ]);
      expect(trashed.items.map((item) => item.intentUpdatedByName)).toEqual(['更新人', '更新人']);
      expect(mockPrisma.employee.findMany).toHaveBeenCalledTimes(1);
      expect(mockPrisma.employee.findMany).toHaveBeenCalledWith({
        where: { id: { in: ['emp-intent'] } },
        select: { id: true, name: true },
      });
    });

    it('详情使用单次员工查询，无更新人时无需查询', async () => {
      const customer = {
        ...buildCustomer(),
        nextFollowUpAt: new Date('2026-09-11T00:00:00.000Z'),
        intentUpdatedById: 'emp-intent',
        contacts: [],
      };
      mockPrisma.customer.findFirst.mockResolvedValue(customer);
      mockPrisma.employee.findUnique.mockResolvedValue({ name: '更新人' });
      const result = await service.findOne(customer.id);
      expect(result.nextFollowUpAt).toBe('2026-09-11');
      expect(result.intentUpdatedByName).toBe('更新人');
      expect(mockPrisma.employee.findUnique).toHaveBeenCalledTimes(1);
      expect(mockPrisma.employee.findUnique).toHaveBeenCalledWith({
        where: { id: 'emp-intent' },
        select: { name: true },
      });
      mockPrisma.employee.findUnique.mockClear();
      mockPrisma.customer.findFirst.mockResolvedValue({
        ...customer,
        nextFollowUpAt: null,
        intentUpdatedById: null,
      });
      const empty = await service.findOne(customer.id);
      expect(empty.nextFollowUpAt).toBeNull();
      expect(empty.intentUpdatedByName).toBeNull();
      expect(mockPrisma.employee.findUnique).not.toHaveBeenCalled();
    });
  });

  describe('findAll', () => {
    it('should return paginated customers with default params', async () => {
      const customers = [buildCustomer(), buildCustomer()];
      mockPrisma.customer.findMany.mockResolvedValue(customers);
      mockPrisma.customer.count.mockResolvedValue(2);

      const result = await service.findAll({ page: 1, pageSize: 10, sortOrder: 'desc' });

      expect(result.items).toHaveLength(2);
      expect(result.total).toBe(2);
      expect(result.page).toBe(1);
      expect(result.pageSize).toBe(10);
      expect(result.totalPages).toBe(1);
      expect(mockFilterApplier.buildWhere).toHaveBeenCalledWith({
        registry: CUSTOMER_FILTER_REGISTRY,
        rawQuery: undefined,
        legacyKeyword: undefined,
        legacyFilters: {
          status: undefined,
          customerLevel: undefined,
          customerSource: undefined,
          contactStatus: undefined,
          dealStatus: undefined,
          chargerId: undefined,
          hasContactPhone: undefined,
        },
        chargerScope: null,
        baseWhere: { deletedAt: null },
      });
      expect(mockPrisma.customer.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          skip: 0,
          take: 10,
          where: { deletedAt: null },
          orderBy: { createdAt: 'desc' },
        })
      );
    });

    it('按意向温度以业务顺序排序并在分页后返回结果', async () => {
      const customers = [
        { ...buildCustomer(), intentTemperature: 'UNJUDGED', createdAt: new Date('2026-09-01') },
        { ...buildCustomer(), intentTemperature: 'LOW', createdAt: new Date('2026-09-02') },
        { ...buildCustomer(), intentTemperature: 'HIGH', createdAt: new Date('2026-09-03') },
        { ...buildCustomer(), intentTemperature: 'NONE', createdAt: new Date('2026-09-04') },
        { ...buildCustomer(), intentTemperature: 'MEDIUM', createdAt: new Date('2026-09-05') },
      ];
      mockPrisma.customer.findMany.mockResolvedValue(customers);
      mockPrisma.customer.count.mockResolvedValue(customers.length);

      const result = await service.findAll({
        page: 2,
        pageSize: 2,
        sortBy: 'intentTemperature',
        sortOrder: 'asc',
      });

      expect(result.items.map((item) => item.intentTemperature)).toEqual(['LOW', 'NONE']);
      expect(mockPrisma.customer.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { deletedAt: null },
          orderBy: { intentTemperature: 'asc' },
        })
      );
      expect(mockPrisma.customer.findMany.mock.calls[0]?.[0]).not.toHaveProperty('take');
    });

    it('should merge legacy query fields into FilterApplier input', async () => {
      mockPrisma.customer.findMany.mockResolvedValue([]);
      mockPrisma.customer.count.mockResolvedValue(0);

      await service.findAll({
        keyword: '示例',
        customerLevel: ['A'],
        customerSource: ['老客户介绍'],
        contactStatus: ['已电话'],
        dealStatus: ['已赢单'],
        chargerId: 'charger-1',
        hasContactPhone: 'yes',
        page: 1,
        pageSize: 10,
        sortOrder: 'desc',
      });

      expect(mockFilterApplier.buildWhere).toHaveBeenCalledWith(
        expect.objectContaining({
          legacyKeyword: '示例',
          legacyFilters: {
            status: undefined,
            customerLevel: ['A'],
            customerSource: ['老客户介绍'],
            contactStatus: ['已电话'],
            dealStatus: ['已赢单'],
            chargerId: 'charger-1',
            hasContactPhone: 'yes',
          },
        })
      );
    });

    it('should pass rawQuery through for new filters payload', async () => {
      mockPrisma.customer.findMany.mockResolvedValue([]);
      mockPrisma.customer.count.mockResolvedValue(0);
      const rawQuery = {
        keyword: '负责人',
        'filters[createdAt][from]': '2026-01-01',
        'filters[customerLevel][]': ['A', 'B'],
      };

      await service.findAll(
        { page: 1, pageSize: 10, sortOrder: 'desc' },
        ['emp-1'],
        'emp-1',
        rawQuery
      );

      expect(mockFilterApplier.buildWhere).toHaveBeenCalledWith(
        expect.objectContaining({
          rawQuery,
          // chargerScope 走 baseWhere.OR 注入，不再透传给 FilterApplier
          chargerScope: null,
        })
      );
    });

    it('should calculate pagination correctly for page 2', async () => {
      mockPrisma.customer.findMany.mockResolvedValue([]);
      mockPrisma.customer.count.mockResolvedValue(25);

      const result = await service.findAll({ page: 2, pageSize: 10, sortOrder: 'desc' });

      expect(result.totalPages).toBe(3);
      expect(mockPrisma.customer.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 10, take: 10 })
      );
    });

    it('should exclude soft-deleted records', async () => {
      mockPrisma.customer.findMany.mockResolvedValue([]);
      mockPrisma.customer.count.mockResolvedValue(0);

      await service.findAll({ page: 1, pageSize: 10, sortOrder: 'desc' });

      expect(mockPrisma.customer.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ deletedAt: null }),
        })
      );
    });

    it('should query public pool without charger scope', async () => {
      mockPrisma.customer.findMany.mockResolvedValue([]);
      mockPrisma.customer.count.mockResolvedValue(0);

      await service.findAll({ pool: 'public', page: 1, pageSize: 10, sortOrder: 'desc' }, [
        'emp-1',
      ]);

      expect(mockFilterApplier.buildWhere).toHaveBeenCalledWith(
        expect.objectContaining({
          chargerScope: null,
          baseWhere: { deletedAt: null, chargerId: null },
        })
      );
    });

    it('should exclude public pool from admin private view', async () => {
      mockPrisma.customer.findMany.mockResolvedValue([]);
      mockPrisma.customer.count.mockResolvedValue(0);

      await service.findAll({ pool: 'private', page: 1, pageSize: 10, sortOrder: 'desc' }, null);

      expect(mockFilterApplier.buildWhere).toHaveBeenCalledWith(
        expect.objectContaining({
          chargerScope: null,
          baseWhere: { deletedAt: null, chargerId: { not: null } },
        })
      );
    });

    it('should filter by MQL/SQL when querying leads pool', async () => {
      mockPrisma.customer.findMany.mockResolvedValue([]);
      mockPrisma.customer.count.mockResolvedValue(0);

      await service.findAll({ pool: 'leads', page: 1, pageSize: 10, sortOrder: 'desc' }, null);

      expect(mockFilterApplier.buildWhere).toHaveBeenCalledWith(
        expect.objectContaining({
          chargerScope: null,
          baseWhere: expect.objectContaining({
            deletedAt: null,
            leadStage: { in: ['MQL', 'SQL'] },
          }),
        })
      );
      // leads 池不应强制 chargerId（私海 admin 兜底）也不应限定 chargerId=null（公海）
      const callArg = mockFilterApplier.buildWhere.mock.calls.at(-1)?.[0];
      expect(callArg?.baseWhere).not.toHaveProperty('chargerId');
    });
  });

  describe('findOne', () => {
    it('should return a customer with contacts', async () => {
      const customer = buildCustomer({ id: 'cust-1' });
      mockPrisma.customer.findFirst.mockResolvedValue({
        ...customer,
        contacts: [],
      });

      const result = await service.findOne('cust-1');

      expect(result).toBeDefined();
      expect(mockPrisma.customer.findFirst).toHaveBeenCalledWith({
        where: { id: 'cust-1', deletedAt: null },
        include: expect.objectContaining({
          contacts: expect.objectContaining({
            where: { deletedAt: null },
          }),
        }),
      });
    });

    it('should throw NotFoundException when customer does not exist', async () => {
      mockPrisma.customer.findFirst.mockResolvedValue(null);

      await expect(service.findOne('non-exist')).rejects.toThrow(NotFoundException);
    });

    it('should allow scoped users to view public pool customer details', async () => {
      const customer = buildCustomer({ id: 'cust-public', chargerId: null });
      mockPrisma.customer.findFirst.mockResolvedValue({
        ...customer,
        contacts: [],
      });

      await service.findOne('cust-public', ['emp-1'], null, { includePublicPool: true });

      expect(mockPrisma.customer.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            id: 'cust-public',
            deletedAt: null,
            OR: [{ chargerId: { in: ['emp-1'] } }, { chargerId: null }],
          },
        })
      );
    });
  });

  describe('create', () => {
    it('创建时原子写入无事实默认派生值，不打开提交后二次生命周期事务', async () => {
      const customer = buildCustomer({
        contactStatus: CONTACT_STATUS.UNTOUCHED,
        dealStatus: DEAL_STATUS.NOT_WON,
      });
      // 即使二次事务被注入为失败，create 也不应触发该窗口。
      mockPrisma.$transaction.mockRejectedValue(new Error('unexpected lifecycle transaction'));
      const refreshStatus = vi
        .spyOn(service, 'refreshCustomerStatus')
        .mockRejectedValue(new Error('unexpected status refresh'));
      const refreshLifecycle = vi
        .spyOn(service, 'refreshCustomerLifecycle')
        .mockRejectedValue(new Error('unexpected lifecycle refresh'));
      mockPrisma.customer.findMany.mockResolvedValue([]);
      mockPrisma.customer.create.mockResolvedValue(customer);

      const result = await service.create(
        { customerName: '新客户' } as Parameters<typeof service.create>[0],
        { id: 'user-1', employeeId: 'emp-' + 'user-1' }
      );

      expect(result.contactStatus).toBe(CONTACT_STATUS.UNTOUCHED);
      expect(result.dealStatus).toBe(DEAL_STATUS.NOT_WON);
      expect(mockSerialNumber.generate).toHaveBeenCalled();
      expect(mockPrisma.customer.create).toHaveBeenCalledTimes(1);
      expect(mockPrisma.customer.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          serialNumber: expect.stringMatching(/^KH/),
          customerName: '新客户',
          contactStatus: CONTACT_STATUS.UNTOUCHED,
          dealStatus: DEAL_STATUS.NOT_WON,
        }),
      });
      expect(refreshStatus).not.toHaveBeenCalled();
      expect(refreshLifecycle).not.toHaveBeenCalled();
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
      expect(mockPrisma.keepRecord.findFirst).not.toHaveBeenCalled();
      expect(mockPrisma.visitRecord.findFirst).not.toHaveBeenCalled();
      expect(mockPrisma.opportunity.count).not.toHaveBeenCalled();
    });

    it('should handle customerTags JSON field', async () => {
      const customer = buildCustomer({ customerTags: ['tag1', 'tag2'] });
      mockPrisma.customer.findMany.mockResolvedValue([]);
      mockPrisma.customer.create.mockResolvedValue(customer);

      await service.create(
        { customerName: '新客户', customerTags: ['tag1', 'tag2'] } as Parameters<
          typeof service.create
        >[0],
        { id: 'user-1', employeeId: 'emp-' + 'user-1' }
      );

      expect(mockPrisma.customer.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          customerTags: expect.anything(),
        }),
      });
    });

    it('should throw 409 when duplicate customerName found and forceCreate is not set', async () => {
      const existing = buildCustomer({ id: 'existing-1', customerName: '已存在客户' });
      mockPrisma.customer.findMany.mockResolvedValue([
        {
          ...existing,
          charger: null,
          contacts: [],
        },
      ]);

      await expect(
        service.create({ customerName: '已存在客户' } as Parameters<typeof service.create>[0], {
          id: 'user-1',
          employeeId: 'emp-user-1',
        })
      ).rejects.toThrow(/重复客户/);
      expect(mockPrisma.customer.create).not.toHaveBeenCalled();
    });

    it('should bypass duplicate check when forceCreate=true', async () => {
      const customer = buildCustomer();
      // 即使 findMany 返回有重复，forceCreate=true 也应跳过
      mockPrisma.customer.findMany.mockResolvedValue([
        { ...buildCustomer({ id: 'existing-1' }), charger: null, contacts: [] },
      ]);
      mockPrisma.customer.create.mockResolvedValue(customer);

      const result = await service.create(
        { customerName: '已存在客户', forceCreate: true } as Parameters<typeof service.create>[0],
        { id: 'user-1', employeeId: 'emp-user-1' }
      );

      expect(result).toBeDefined();
      expect(mockPrisma.customer.create).toHaveBeenCalled();
    });
  });

  describe('update', () => {
    it('元数据更新在目标锁内复查 pending 后执行 CAS，不打开提交后二次生命周期事务', async () => {
      const existing = buildCustomer({
        id: 'cust-1',
        version: 1,
        customerName: '原名称',
        contactStatus: CONTACT_STATUS.VISITED,
        dealStatus: DEAL_STATUS.WON,
      });
      const updated = buildCustomer({
        ...existing,
        version: 2,
        customerName: '更新名称',
      });
      const refreshStatus = vi
        .spyOn(service, 'refreshCustomerStatus')
        .mockRejectedValue(new Error('unexpected status refresh'));
      const refreshLifecycle = vi
        .spyOn(service, 'refreshCustomerLifecycle')
        .mockRejectedValue(new Error('unexpected lifecycle refresh'));
      mockPrisma.customer.findFirst.mockResolvedValue({ ...existing, contacts: [] });
      mockPrisma.customer.update.mockResolvedValue(updated);

      const result = await service.update(
        'cust-1',
        { customerName: '更新名称', version: 1 } as Parameters<typeof service.update>[1],
        { id: 'user-1', employeeId: 'emp-' + 'user-1' }
      );

      expect(mockPrisma.customer.update).toHaveBeenCalledTimes(1);
      expect(mockPrisma.customer.update).toHaveBeenCalledWith({
        where: { id: 'cust-1', version: 1, deletedAt: null },
        data: expect.objectContaining({
          customerName: '更新名称',
          version: { increment: 1 },
        }),
      });
      expect(result.customerName).toBe('更新名称');
      expect(result.version).toBe(2);
      expect(result.contactStatus).toBe(CONTACT_STATUS.VISITED);
      expect(result.dealStatus).toBe(DEAL_STATUS.WON);
      expect(refreshStatus).not.toHaveBeenCalled();
      expect(refreshLifecycle).not.toHaveBeenCalled();
      expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
      expect(mockPrisma.$executeRaw).toHaveBeenCalledTimes(1);
      expect(mockPrisma.approvalChangeRequest.findFirst).toHaveBeenCalledWith({
        where: {
          eventType: 'customer_tag_change',
          targetType: 'customer',
          targetId: { in: ['cust-1'] },
          status: 'pending',
          deletedAt: null,
        },
        select: { id: true, targetId: true, title: true },
      });
      expect(mockPrisma.$executeRaw.mock.invocationCallOrder[0]).toBeLessThan(
        mockPrisma.approvalChangeRequest.findFirst.mock.invocationCallOrder[0]!
      );
      expect(mockPrisma.approvalChangeRequest.findFirst.mock.invocationCallOrder[0]).toBeLessThan(
        mockPrisma.customer.update.mock.invocationCallOrder[0]!
      );
      expect(mockPrisma.keepRecord.findFirst).not.toHaveBeenCalled();
      expect(mockPrisma.visitRecord.findFirst).not.toHaveBeenCalled();
      expect(mockPrisma.opportunity.count).not.toHaveBeenCalled();
    });

    it('should throw ConflictException on P2025 error (optimistic lock)', async () => {
      const existing = buildCustomer({ id: 'cust-1', version: 1 });
      mockPrisma.customer.findFirst.mockResolvedValue({ ...existing, contacts: [] });

      const prismaError = new Prisma.PrismaClientKnownRequestError('', {
        code: 'P2025',
        clientVersion: '0',
      });
      mockPrisma.customer.update.mockRejectedValue(prismaError);

      await expect(
        service.update(
          'cust-1',
          { customerName: '更新', version: 1 } as Parameters<typeof service.update>[1],
          { id: 'user-1', employeeId: 'emp-' + 'user-1' }
        )
      ).rejects.toThrow(ConflictException);
    });

    it('确定性 barrier：同 version 在等锁期间丢失 scope，最终 CAS 零写入并统一返回 409', async () => {
      const existing = buildCustomer({
        id: 'cust-1',
        version: 7,
        chargerId: 'emp-owner',
      });
      let releaseLock!: () => void;
      const lockBarrier = new Promise<void>((resolve) => {
        releaseLock = resolve;
      });
      let scopeLost = false;
      let committedWrites = 0;
      mockPrisma.customer.findFirst.mockResolvedValue({ ...existing, contacts: [] });
      mockPrisma.$executeRaw.mockImplementation(async () => lockBarrier);
      mockPrisma.customer.update.mockImplementation(async () => {
        if (scopeLost) {
          throw new Prisma.PrismaClientKnownRequestError('', {
            code: 'P2025',
            clientVersion: '0',
          });
        }
        committedWrites += 1;
        return { ...existing, version: 8 };
      });

      const pending = service.update(
        'cust-1',
        { customerName: '不会写入', version: 7 } as Parameters<typeof service.update>[1],
        { id: 'user-1', employeeId: 'emp-self' },
        ['emp-owner'],
        'emp-self'
      );
      await vi.waitFor(() => expect(mockPrisma.$executeRaw).toHaveBeenCalledTimes(1));
      expect(mockPrisma.customer.update).not.toHaveBeenCalled();
      scopeLost = true;
      releaseLock();

      await expect(pending).rejects.toBeInstanceOf(ConflictException);
      expect(committedWrites).toBe(0);
      expect(mockPrisma.customer.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            id: 'cust-1',
            version: 7,
            deletedAt: null,
            OR: [
              { chargerId: { in: ['emp-owner'] } },
              { collaboratorIds: { array_contains: ['emp-self'] } },
            ],
          },
        })
      );
    });

    it('should re-throw non-P2025 errors', async () => {
      const existing = buildCustomer({ id: 'cust-1' });
      mockPrisma.customer.findFirst.mockResolvedValue({ ...existing, contacts: [] });
      mockPrisma.customer.update.mockRejectedValue(new Error('DB connection lost'));

      await expect(
        service.update(
          'cust-1',
          { customerName: '更新', version: 1 } as Parameters<typeof service.update>[1],
          {
            id: 'user-1',
            employeeId: 'emp-' + 'user-1',
          }
        )
      ).rejects.toThrow('DB connection lost');
    });

    it('should increment version on successful update', async () => {
      const existing = buildCustomer({ id: 'cust-1', version: 3 });
      mockPrisma.customer.findFirst.mockResolvedValue({ ...existing, contacts: [] });
      mockPrisma.customer.update.mockResolvedValue({ ...existing, version: 4 });

      await service.update(
        'cust-1',
        { customerName: '更新', version: 3 } as Parameters<typeof service.update>[1],
        { id: 'user-1', employeeId: 'emp-' + 'user-1' }
      );

      expect(mockPrisma.customer.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ version: { increment: 1 } }),
        })
      );
    });

    // ─── leadStage 字段守卫 + race condition 防护测试 ───
    //
    // 2026-06 改造后：PUT /customers/:id 不接受任何 leadStage 系列字段（含 ADMIN）；
    // 所有角色统一走 POST /customers/:id/lead-stage-change-request 审批入口。
    // 若申请人=审批人，引擎 autoPassSelfTasksAndAdvance 会自动通过。

    it('should reject leadStage direct edit via PUT for ANY role (including ADMIN)', async () => {
      const existing = buildCustomer({ id: 'cust-1', version: 1 });
      mockPrisma.customer.findFirst.mockResolvedValue({ ...existing, contacts: [] });

      // 非 ADMIN
      await expect(
        service.update(
          'cust-1',
          { leadStage: 'MQL', version: 1 } as Parameters<typeof service.update>[1],
          { id: 'user-1', employeeId: 'emp-1' },
          null,
          null,
          ['SALES']
        )
      ).rejects.toThrow('不允许通过 PUT 修改');

      // ADMIN 也一样被拦
      await expect(
        service.update(
          'cust-1',
          { leadStage: 'MQL', version: 1 } as Parameters<typeof service.update>[1],
          { id: 'admin-1', employeeId: 'emp-admin' },
          null,
          null,
          ['ADMIN']
        )
      ).rejects.toThrow('不允许通过 PUT 修改');
    });

    it('should reject when ANY role tries to inject audit fields (leadStageUpdatedAt)', async () => {
      const existing = buildCustomer({ id: 'cust-1', version: 1 });
      mockPrisma.customer.findFirst.mockResolvedValue({ ...existing, contacts: [] });

      // 哪怕 ADMIN 也不能传 audit 字段——与业务字段一起被守卫 1 统一拦截
      await expect(
        service.update(
          'cust-1',
          {
            leadStageUpdatedAt: '1970-01-01T00:00:00Z',
            version: 1,
          } as unknown as Parameters<typeof service.update>[1],
          { id: 'admin-1', employeeId: 'emp-admin' },
          null,
          null,
          ['ADMIN']
        )
      ).rejects.toThrow('不允许通过 PUT 修改');
    });

    it('should reject PUT when customer has pending CUSTOMER_TAG_CHANGE approval (race condition guard)', async () => {
      const existing = buildCustomer({ id: 'cust-1', version: 1 });
      mockPrisma.customer.findFirst.mockResolvedValue({ ...existing, contacts: [] });
      mockPrisma.approvalChangeRequest.findFirst.mockResolvedValueOnce({
        id: 'change-1',
        targetId: 'cust-1',
        title: '线索阶段变更｜某客户｜无 → SQL',
      } as never);

      await expect(
        service.update(
          'cust-1',
          { customerName: '改个地址', version: 1 } as Parameters<typeof service.update>[1],
          { id: 'admin-1', employeeId: 'emp-admin' },
          null,
          null,
          ['ADMIN']
        )
      ).rejects.toThrow('请审批人先处理');

      expect(mockPrisma.$executeRaw).toHaveBeenCalledTimes(1);
      expect(mockPrisma.approvalChangeRequest.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            eventType: 'customer_tag_change',
            targetType: 'customer',
            targetId: { in: ['cust-1'] },
            status: 'pending',
          }),
        })
      );
      expect(mockPrisma.customer.update).not.toHaveBeenCalled();
    });
  });

  describe('submitLeadStageChangeRequest', () => {
    type SubmitInput = Parameters<BusinessApprovalService['submitChangeApproval']>[0];

    it('中央行锁后按 id+version+leadStage+当前 scope 复验，再允许创建变更申请', async () => {
      const existing = buildCustomer({
        id: 'cust-1',
        version: 4,
        leadStage: 'MQL',
        chargerId: 'emp-owner',
      });
      mockPrisma.customer.findFirst
        .mockResolvedValueOnce({ ...existing, contacts: [] })
        .mockResolvedValueOnce({ id: 'cust-1' });
      mockBusinessApproval.submitChangeApproval.mockImplementation(async (input: SubmitInput) => {
        await input.validateInTransaction?.(mockPrisma as never);
        return { id: 'mock-instance' };
      });

      await service.submitLeadStageChangeRequest(
        'cust-1',
        { leadStage: 'SQL', version: 4 },
        { id: 'user-1', employeeId: 'emp-self' },
        ['emp-owner'],
        'emp-self'
      );

      const input = mockBusinessApproval.submitChangeApproval.mock.calls[0]?.[0] as SubmitInput;
      expect(input.baseVersion).toBe(4);
      expect(input.validateInTransaction).toEqual(expect.any(Function));
      expect(mockPrisma.customer.findFirst).toHaveBeenNthCalledWith(2, {
        where: expect.objectContaining({
          id: 'cust-1',
          version: 4,
          deletedAt: null,
          leadStage: 'MQL',
        }),
        select: { id: true },
      });
      expect(mockPrisma.customer.findFirst.mock.calls[1]?.[0]?.where).toHaveProperty('OR');
    });

    it.each(['普通 PUT 抢先提交', '软删除抢先提交', '转交导致 scope 漂移'])(
      '预读后发生%s时锁后复验返回 409，且不会进入 create',
      async () => {
        const existing = buildCustomer({
          id: 'cust-1',
          version: 3,
          leadStage: 'MQL',
          chargerId: 'emp-owner',
        });
        const createAfterValidation = vi.fn();
        mockPrisma.customer.findFirst
          .mockResolvedValueOnce({ ...existing, contacts: [] })
          .mockResolvedValueOnce(null);
        mockBusinessApproval.submitChangeApproval.mockImplementation(async (input: SubmitInput) => {
          await input.validateInTransaction?.(mockPrisma as never);
          createAfterValidation();
          return { id: 'should-not-create' };
        });

        await expect(
          service.submitLeadStageChangeRequest(
            'cust-1',
            { leadStage: 'SQL', version: 3 },
            { id: 'user-1', employeeId: 'emp-self' },
            ['emp-owner'],
            'emp-self'
          )
        ).rejects.toThrow(ConflictException);

        expect(mockBusinessApproval.submitChangeApproval).toHaveBeenCalledTimes(1);
        expect(mockPrisma.customer.findFirst).toHaveBeenCalledTimes(2);
        expect(createAfterValidation).not.toHaveBeenCalled();
      }
    );
  });

  describe('correctLeadStage', () => {
    it('按原始业务时间恢复 SQL，且不改推进状态和首次 SQL 时间', async () => {
      const originalQualifiedAt = new Date('2026-07-20T07:55:50.524Z');
      const firstSqlAt = new Date('2026-07-20T07:55:50.524Z');
      const before = buildCustomer({
        id: 'cust-1',
        version: 4,
        leadStage: 'MQL',
        leadStageQualifiedAt: new Date('2026-08-18T02:14:52.664Z'),
        firstSqlAt,
        leadProgressStatus: 'LOST',
      });
      const after = buildCustomer({
        ...before,
        version: 5,
        leadStage: 'SQL',
        leadStageQualifiedAt: originalQualifiedAt,
      });
      mockPrisma.customer.findFirst
        .mockResolvedValueOnce({ ...before, contacts: [] })
        .mockResolvedValueOnce({ ...after, contacts: [] });
      mockPrisma.customer.update.mockResolvedValue(after);

      await service.correctLeadStage(
        'cust-1',
        {
          leadStage: 'SQL',
          leadStageQualifiedAt: originalQualifiedAt.toISOString(),
          reason: '修复进展状态误降级',
          version: 4,
        },
        { id: 'user-1', employeeId: 'emp-1' }
      );

      const updateData = mockPrisma.customer.update.mock.calls[0]?.[0]?.data;
      expect(mockPrisma.customer.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'cust-1', version: 4, deletedAt: null },
          data: expect.objectContaining({
            leadStage: 'SQL',
            leadStageQualifiedAt: originalQualifiedAt,
            leadStageUpdatedAt: expect.any(Date),
            version: { increment: 1 },
          }),
        })
      );
      expect(updateData).not.toHaveProperty('leadProgressStatus');
      expect(updateData).not.toHaveProperty('leadProgressUpdatedAt');
      expect(updateData).not.toHaveProperty('firstSqlAt');
    });
  });

  describe('updateLeadProgress', () => {
    it('预约拜访时只更新进展和预约时间，不自动升级线索阶段', async () => {
      const before = buildCustomer({
        id: 'cust-1',
        version: 2,
        leadStage: 'MQL',
        leadProgressStatus: 'ACTIVE',
        firstSqlAt: null,
      });
      const after = buildCustomer({
        ...before,
        version: 3,
        leadProgressStatus: 'PENDING_VISIT',
        leadAppointmentAt: new Date('2026-07-21T02:00:00.000Z'),
      });
      mockPrisma.customer.findFirst
        .mockResolvedValueOnce({ ...before, contacts: [] })
        .mockResolvedValueOnce(before)
        .mockResolvedValueOnce({ ...after, contacts: [] });
      mockPrisma.customer.update.mockResolvedValue(after);

      const result = await service.updateLeadProgress(
        'cust-1',
        {
          status: 'PENDING_VISIT',
          appointmentAt: '2026-07-21T02:00:00.000Z',
          version: 2,
        },
        { id: 'user-1', employeeId: 'emp-1' }
      );

      expect(result.leadProgressStatus).toBe('PENDING_VISIT');
      expect(mockPrisma.customer.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'cust-1', version: 2, deletedAt: null },
          data: expect.objectContaining({
            leadProgressStatus: 'PENDING_VISIT',
            leadAppointmentAt: new Date('2026-07-21T02:00:00.000Z'),
          }),
        })
      );
      const updateData = mockPrisma.customer.update.mock.calls[0]?.[0]?.data;
      expect(updateData).not.toHaveProperty('leadStage');
      expect(updateData).not.toHaveProperty('firstSqlAt');
    });

    it('待拜访线索毁约后保留 SQL 阶段、打标时间和原预约时间', async () => {
      const appointmentAt = new Date('2026-07-21T02:00:00.000Z');
      const qualifiedAt = new Date('2026-07-20T02:00:00.000Z');
      const before = buildCustomer({
        id: 'cust-1',
        version: 2,
        leadStage: 'SQL',
        leadStageQualifiedAt: qualifiedAt,
        leadProgressStatus: 'PENDING_VISIT',
        leadAppointmentAt: appointmentAt,
      });
      const after = buildCustomer({
        ...before,
        version: 3,
        leadProgressStatus: 'NO_SHOW',
        leadProgressReason: '客户临时取消',
      });
      mockPrisma.customer.findFirst
        .mockResolvedValueOnce({ ...before, contacts: [] })
        .mockResolvedValueOnce(before)
        .mockResolvedValueOnce({ ...after, contacts: [] });
      mockPrisma.customer.update.mockResolvedValue(after);

      await service.updateLeadProgress(
        'cust-1',
        { status: 'NO_SHOW', reason: '客户临时取消', version: 2 },
        { id: 'user-1', employeeId: 'emp-1' }
      );

      const updateData = mockPrisma.customer.update.mock.calls[0]?.[0]?.data;
      expect(updateData).toEqual(
        expect.objectContaining({
          leadProgressStatus: 'NO_SHOW',
          leadProgressReason: '客户临时取消',
        })
      );
      expect(updateData).not.toHaveProperty('leadStage');
      expect(updateData).not.toHaveProperty('leadStageQualifiedAt');
      expect(updateData).not.toHaveProperty('leadStageUpdatedAt');
      expect(updateData).not.toHaveProperty('leadStageUpdatedBy');
      expect(updateData).not.toHaveProperty('leadStageQualifiedBy');
      expect(updateData).not.toHaveProperty('leadAppointmentAt');
    });

    it('SQL 线索标记流失时只更新进展，不降级或刷新打标时间', async () => {
      const before = buildCustomer({
        id: 'cust-1',
        version: 2,
        leadStage: 'SQL',
        leadStageQualifiedAt: new Date('2026-07-20T02:00:00.000Z'),
        leadProgressStatus: 'ACTIVE',
      });
      const after = buildCustomer({
        ...before,
        version: 3,
        leadProgressStatus: 'LOST',
        leadProgressReason: '客户暂不采购',
      });
      mockPrisma.customer.findFirst
        .mockResolvedValueOnce({ ...before, contacts: [] })
        .mockResolvedValueOnce(before)
        .mockResolvedValueOnce({ ...after, contacts: [] });
      mockPrisma.customer.update.mockResolvedValue(after);

      await service.updateLeadProgress(
        'cust-1',
        { status: 'LOST', reason: '客户暂不采购', version: 2 },
        { id: 'user-1', employeeId: 'emp-1' }
      );

      const updateData = mockPrisma.customer.update.mock.calls[0]?.[0]?.data;
      expect(updateData).toEqual(
        expect.objectContaining({
          leadProgressStatus: 'LOST',
          leadProgressReason: '客户暂不采购',
        })
      );
      expect(updateData).not.toHaveProperty('leadStage');
      expect(updateData).not.toHaveProperty('leadStageQualifiedAt');
      expect(updateData).not.toHaveProperty('leadStageUpdatedAt');
      expect(updateData).not.toHaveProperty('leadStageUpdatedBy');
      expect(updateData).not.toHaveProperty('leadStageQualifiedBy');
    });

    it('非待拜访状态不能直接标记毁约', async () => {
      const customer = buildCustomer({
        id: 'cust-1',
        version: 1,
        leadStage: 'MQL',
        leadProgressStatus: 'ACTIVE',
      });
      mockPrisma.customer.findFirst.mockResolvedValue({ ...customer, contacts: [] });

      await expect(
        service.updateLeadProgress(
          'cust-1',
          { status: 'NO_SHOW', reason: '无效操作', version: 1 },
          { id: 'user-1', employeeId: 'emp-1' }
        )
      ).rejects.toThrow('只有待拜访线索可以标记毁约');
    });
  });

  describe('syncLeadProgressFromFacts', () => {
    it('晚于人工状态的赢单商机自动推进为 S·已成交', async () => {
      const before = buildCustomer({
        id: 'cust-1',
        version: 2,
        leadStage: 'MQL',
        leadProgressStatus: 'ACTIVE',
        leadProgressUpdatedAt: new Date('2026-07-20T08:00:00.000Z'),
      });
      const after = buildCustomer({
        ...before,
        version: 3,
        leadStage: 'SQL',
        leadProgressStatus: 'WON',
      });
      mockPrisma.customer.findFirst
        .mockResolvedValueOnce(before)
        .mockResolvedValueOnce(before)
        .mockResolvedValueOnce({ ...after, contacts: [] });
      mockPrisma.opportunity.findFirst.mockResolvedValue({
        updatedAt: new Date('2026-07-20T09:00:00.000Z'),
      });
      mockPrisma.visitRecord.findFirst.mockResolvedValue(null);

      await service.syncLeadProgressFromFacts('cust-1', {
        id: 'user-1',
        employeeId: 'emp-1',
      });

      expect(mockPrisma.customer.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            leadStage: 'SQL',
            leadProgressStatus: 'WON',
          }),
        })
      );
    });

    it('线上演示跟进自动推进为 S·已完成演示/拜访', async () => {
      const before = buildCustomer({
        id: 'cust-1',
        version: 2,
        leadStage: 'SQL',
        leadProgressStatus: 'PENDING_VISIT',
        leadAppointmentAt: new Date('2026-08-10T01:45:00.000Z'),
        leadProgressUpdatedAt: new Date('2026-08-12T01:45:31.157Z'),
      });
      const after = buildCustomer({
        ...before,
        version: 3,
        leadProgressStatus: 'VISITED',
      });
      mockPrisma.customer.findFirst
        .mockResolvedValueOnce(before)
        .mockResolvedValueOnce(before)
        .mockResolvedValueOnce({ ...after, contacts: [] });
      mockPrisma.opportunity.findFirst.mockResolvedValue(null);
      mockPrisma.visitRecord.findFirst.mockResolvedValue(null);
      mockPrisma.keepRecord.findFirst.mockResolvedValue({
        createdAt: new Date('2026-08-10T07:52:14.393Z'),
        keepRecordTime: new Date('2026-08-10T07:03:00.000Z'),
      });

      await service.syncLeadProgressFromFacts('cust-1', {
        id: 'user-1',
        employeeId: 'emp-1',
      });

      expect(mockPrisma.keepRecord.findFirst).toHaveBeenCalledWith({
        where: {
          customerId: 'cust-1',
          deletedAt: null,
          AND: [
            { OR: [{ flowStatus: 'approved' }, { flowStatus: null }] },
            { OR: [{ source: null }, { source: { not: 'field_change' } }] },
          ],
          keepRecordType: 'online_demo',
        },
        orderBy: [{ keepRecordTime: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
        select: { createdAt: true, keepRecordTime: true },
      });
      expect(mockPrisma.customer.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            leadProgressStatus: 'VISITED',
          }),
        })
      );
    });

    it('完成事实只推进进展，不把 MQL 自动升级为 SQL', async () => {
      const before = buildCustomer({
        id: 'cust-1',
        version: 2,
        leadStage: 'MQL',
        leadProgressStatus: 'ACTIVE',
        leadProgressUpdatedAt: new Date('2026-08-10T01:00:00.000Z'),
      });
      const after = buildCustomer({
        ...before,
        version: 3,
        leadProgressStatus: 'VISITED',
      });
      mockPrisma.customer.findFirst
        .mockResolvedValueOnce(before)
        .mockResolvedValueOnce(before)
        .mockResolvedValueOnce({ ...after, contacts: [] });
      mockPrisma.opportunity.findFirst.mockResolvedValue(null);
      mockPrisma.visitRecord.findFirst.mockResolvedValue({
        createdAt: new Date('2026-08-10T03:00:00.000Z'),
        signInTime: new Date('2026-08-10T03:00:00.000Z'),
      });
      mockPrisma.keepRecord.findFirst.mockResolvedValue(null);

      await service.syncLeadProgressFromFacts('cust-1', {
        id: 'user-1',
        employeeId: 'emp-1',
      });

      const updateData = mockPrisma.customer.updateMany.mock.calls[0]?.[0]?.data;
      expect(updateData).toEqual(expect.objectContaining({ leadProgressStatus: 'VISITED' }));
      expect(updateData).not.toHaveProperty('leadStage');
      expect(updateData).not.toHaveProperty('leadStageQualifiedAt');
    });

    it('预约前的旧线上演示不会完成新的待拜访任务', async () => {
      const customer = buildCustomer({
        id: 'cust-1',
        leadStage: 'SQL',
        leadProgressStatus: 'PENDING_VISIT',
        leadAppointmentAt: new Date('2026-08-10T08:00:00.000Z'),
        leadProgressUpdatedAt: new Date('2026-08-12T01:45:31.157Z'),
      });
      mockPrisma.customer.findFirst.mockResolvedValue(customer);
      mockPrisma.opportunity.findFirst.mockResolvedValue(null);
      mockPrisma.visitRecord.findFirst.mockResolvedValue(null);
      mockPrisma.keepRecord.findFirst.mockResolvedValue({
        createdAt: new Date('2026-08-10T07:52:14.393Z'),
        keepRecordTime: new Date('2026-08-10T07:03:00.000Z'),
      });

      await service.syncLeadProgressFromFacts('cust-1', {
        id: 'user-1',
        employeeId: 'emp-1',
      });

      const updateData = mockPrisma.customer.updateMany.mock.calls[0]?.[0]?.data;
      expect(updateData).not.toHaveProperty('leadProgressStatus');
    });

    it('删除最后一条完成事实后回退为 S·待拜访', async () => {
      const appointmentAt = new Date('2026-08-10T01:45:00.000Z');
      const before = buildCustomer({
        id: 'cust-1',
        version: 3,
        leadStage: 'SQL',
        leadProgressStatus: 'VISITED',
        leadAppointmentAt: appointmentAt,
      });
      const after = buildCustomer({
        ...before,
        version: 4,
        leadProgressStatus: 'PENDING_VISIT',
      });
      mockPrisma.customer.findFirst
        .mockResolvedValueOnce(before)
        .mockResolvedValueOnce(before)
        .mockResolvedValueOnce({ ...after, contacts: [] });
      mockPrisma.opportunity.findFirst.mockResolvedValue(null);
      mockPrisma.visitRecord.findFirst.mockResolvedValue(null);
      mockPrisma.keepRecord.findFirst.mockResolvedValue(null);

      await service.syncLeadProgressFromFacts('cust-1', {
        id: 'user-1',
        employeeId: 'emp-1',
      });

      expect(mockPrisma.customer.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            leadProgressStatus: 'PENDING_VISIT',
          }),
        })
      );
    });

    it('旧拜访记录不会覆盖销售后来标记的流失', async () => {
      const customer = buildCustomer({
        id: 'cust-1',
        leadStage: 'MQL',
        leadProgressStatus: 'LOST',
        leadProgressUpdatedAt: new Date('2026-07-20T09:00:00.000Z'),
      });
      mockPrisma.customer.findFirst.mockResolvedValue(customer);
      mockPrisma.opportunity.findFirst.mockResolvedValue(null);
      mockPrisma.visitRecord.findFirst.mockResolvedValue({
        createdAt: new Date('2026-07-19T09:00:00.000Z'),
        signInTime: new Date('2026-07-19T09:00:00.000Z'),
      });

      await service.syncLeadProgressFromFacts('cust-1', {
        id: 'user-1',
        employeeId: 'emp-1',
      });

      const updateData = mockPrisma.customer.updateMany.mock.calls[0]?.[0]?.data;
      expect(updateData).not.toHaveProperty('leadProgressStatus');
    });
  });

  describe('remove', () => {
    it('should soft delete by setting deletedAt', async () => {
      const customer = buildCustomer({ id: 'cust-1' });
      mockPrisma.customer.findFirst.mockResolvedValue({ ...customer, contacts: [] });
      mockPrisma.customer.update.mockResolvedValue(customer);

      await service.remove(
        'cust-1',
        { id: 'user-1', employeeId: 'emp-' + 'user-1' },
        undefined,
        undefined,
        customer.version
      );

      expect(mockPrisma.customer.update).toHaveBeenCalledWith({
        where: { id: 'cust-1', version: customer.version, deletedAt: null },
        data: expect.objectContaining({
          deletedAt: expect.any(Date),
          version: { increment: 1 },
        }),
      });
      // 正常软删客户仅打开含目标锁、pending 复查和 CAS 的单事务，不重算生命周期。
      expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
      expect(mockPrisma.$executeRaw).toHaveBeenCalledTimes(1);
      expect(mockPrisma.$queryRaw).not.toHaveBeenCalled();
      expect(mockPrisma.keepRecord.findFirst).not.toHaveBeenCalled();
      expect(mockPrisma.visitRecord.findFirst).not.toHaveBeenCalled();
    });

    it('stale version 的软删除把 P2025 转为 ConflictException', async () => {
      const customer = buildCustomer({ id: 'cust-1', version: 3 });
      mockPrisma.customer.findFirst.mockResolvedValue({ ...customer, contacts: [] });
      mockPrisma.customer.update.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('', {
          code: 'P2025',
          clientVersion: '0',
        })
      );

      await expect(
        service.remove(
          'cust-1',
          { id: 'user-1', employeeId: 'emp-user-1' },
          undefined,
          undefined,
          2
        )
      ).rejects.toThrow(ConflictException);
    });

    it('确定性 barrier：软删等锁期间同 version 丢失 scope，最终 CAS 零写入并统一返回 409', async () => {
      const customer = buildCustomer({
        id: 'cust-1',
        version: 3,
        chargerId: 'emp-owner',
      });
      let releaseLock!: () => void;
      const lockBarrier = new Promise<void>((resolve) => {
        releaseLock = resolve;
      });
      let scopeLost = false;
      let committedWrites = 0;
      mockPrisma.customer.findFirst.mockResolvedValue({ ...customer, contacts: [] });
      mockPrisma.$executeRaw.mockImplementation(async () => lockBarrier);
      mockPrisma.customer.update.mockImplementation(async () => {
        if (scopeLost) {
          throw new Prisma.PrismaClientKnownRequestError('', {
            code: 'P2025',
            clientVersion: '0',
          });
        }
        committedWrites += 1;
        return customer;
      });

      const pending = service.remove(
        'cust-1',
        { id: 'user-1', employeeId: 'emp-self' },
        ['emp-owner'],
        'emp-self',
        3
      );
      await vi.waitFor(() => expect(mockPrisma.$executeRaw).toHaveBeenCalledTimes(1));
      expect(mockPrisma.customer.update).not.toHaveBeenCalled();
      scopeLost = true;
      releaseLock();

      await expect(pending).rejects.toBeInstanceOf(ConflictException);
      expect(committedWrites).toBe(0);
      expect(mockPrisma.customer.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            id: 'cust-1',
            version: 3,
            deletedAt: null,
            OR: [
              { chargerId: { in: ['emp-owner'] } },
              { collaboratorIds: { array_contains: ['emp-self'] } },
            ],
          },
        })
      );
    });

    it('should throw NotFoundException when customer does not exist', async () => {
      mockPrisma.customer.findFirst.mockResolvedValue(null);

      await expect(
        service.remove(
          'non-exist',
          { id: 'user-1', employeeId: 'emp-' + 'user-1' },
          undefined,
          undefined,
          1
        )
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('findTrashed', () => {
    it('should query only soft-deleted records', async () => {
      mockPrisma.customer.findMany.mockResolvedValue([]);
      mockPrisma.customer.count.mockResolvedValue(0);

      await service.findTrashed({ page: 1, pageSize: 10, sortOrder: 'desc' });

      expect(mockPrisma.customer.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ deletedAt: { not: null } }),
          orderBy: { deletedAt: 'desc' },
        })
      );
    });

    it('should support keyword filter in trashed', async () => {
      mockPrisma.customer.findMany.mockResolvedValue([]);
      mockPrisma.customer.count.mockResolvedValue(0);

      await service.findTrashed({ keyword: '测试', page: 1, pageSize: 10, sortOrder: 'desc' });

      expect(mockPrisma.customer.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            OR: [
              { customerName: { contains: '测试', mode: 'insensitive' } },
              { serialNumber: { contains: '测试', mode: 'insensitive' } },
            ],
          }),
        })
      );
    });
  });

  describe('restore', () => {
    it('使用调用方版本恢复并同事务重算，最终严格只增加一次 version', async () => {
      const customer = buildCustomer({ id: 'cust-1', version: 5, deletedAt: new Date() });
      const lifecycleSnapshot = {
        ...buildCustomer({
          ...customer,
          version: 6,
          deletedAt: null,
          contactStatus: '未接触',
          dealStatus: '未赢单',
        }),
        leadStage: null,
        leadProgressStatus: null,
        leadProgressUpdatedAt: null,
        leadAppointmentAt: null,
        leadProgressReason: null,
        leadProgressUpdatedById: null,
        leadStageUpdatedAt: null,
        leadStageUpdatedById: null,
        leadStageQualifiedAt: null,
        leadStageQualifiedById: null,
        firstSqlAt: null,
        lastKeepRecordTime: null,
        lastKeepRecordContent: null,
        updaterEmployeeId: 'emp-user-1',
      };
      const response = { ...lifecycleSnapshot, contactStatus: '已拜访', contacts: [] };
      mockPrisma.customer.findFirst
        .mockResolvedValueOnce(customer)
        .mockResolvedValueOnce(lifecycleSnapshot)
        .mockResolvedValueOnce(response);
      mockPrisma.keepRecord.findFirst.mockResolvedValue(null);
      mockPrisma.visitRecord.findFirst.mockResolvedValue({
        visitType: 'onsite',
        createdAt: new Date('2026-08-20T10:00:00.000Z'),
        signInTime: new Date('2026-08-20T10:00:00.000Z'),
      });
      mockPrisma.opportunity.count.mockResolvedValue(0);
      mockPrisma.customer.updateMany.mockResolvedValue({ count: 1 });

      const result = await service.restore(
        'cust-1',
        { version: 5 },
        { id: 'user-1', employeeId: 'emp-user-1' }
      );

      expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
      expect(mockPrisma.customer.updateMany).toHaveBeenNthCalledWith(1, {
        where: { id: 'cust-1', version: 5, deletedAt: { not: null } },
        data: {
          deletedAt: null,
          updaterEmployeeId: 'emp-user-1',
          version: { increment: 1 },
        },
      });
      expect(mockPrisma.customer.updateMany).toHaveBeenNthCalledWith(2, {
        where: { id: 'cust-1', version: 6, deletedAt: null },
        data: expect.not.objectContaining({ version: expect.anything() }),
      });
      expect(mockPrisma.customer.updateMany.mock.invocationCallOrder[0]).toBeLessThan(
        mockPrisma.$queryRaw.mock.invocationCallOrder[0]!
      );
      expect(result.version).toBe(6);
      expect(result.contactStatus).toBe('已拜访');
    });

    it('调用方 stale version 或删除状态变化统一返回 409，且不启动恢复事务', async () => {
      mockPrisma.customer.findFirst.mockResolvedValue(
        buildCustomer({ id: 'cust-1', version: 6, deletedAt: new Date() })
      );

      await expect(
        service.restore('cust-1', { version: 5 }, { id: 'user-1', employeeId: 'emp-user-1' })
      ).rejects.toBeInstanceOf(ConflictException);
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();

      vi.clearAllMocks();
      mockPrisma.customer.findFirst.mockResolvedValue(
        buildCustomer({ id: 'cust-1', version: 5, deletedAt: null })
      );
      await expect(
        service.restore('cust-1', { version: 5 }, { id: 'user-1', employeeId: 'emp-user-1' })
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('生命周期重算失败时恢复事务整体失败，不返回半恢复结果', async () => {
      const customer = buildCustomer({ id: 'cust-1', version: 5, deletedAt: new Date() });
      mockPrisma.customer.findFirst.mockResolvedValueOnce(customer);
      mockPrisma.customer.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.$queryRaw.mockRejectedValue(new Error('lifecycle lock failed'));

      await expect(
        service.restore('cust-1', { version: 5 }, { id: 'user-1', employeeId: 'emp-user-1' })
      ).rejects.toThrow('lifecycle lock failed');

      expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
      expect(mockPrisma.customer.findFirst).toHaveBeenCalledTimes(1);
    });

    it('请求开始时就不存在仍返回 404', async () => {
      mockPrisma.customer.findFirst.mockResolvedValue(null);

      await expect(
        service.restore('non-exist', { version: 1 }, { id: 'user-1', employeeId: 'emp-user-1' })
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('claim', () => {
    it('锁前区分存在性，锁后以 id/version/deletedAt/公海条件 CAS 认领', async () => {
      const before = buildCustomer({ id: 'cust-public', chargerId: null, version: 3 });
      const after = buildCustomer({ ...before, chargerId: 'emp-1', version: 4 });
      mockPrisma.customer.findFirst
        .mockResolvedValueOnce({ id: 'cust-public' })
        .mockResolvedValueOnce({ ...after, contacts: [] });
      mockPrisma.customer.findUnique.mockResolvedValue(before);
      mockPrisma.customer.updateMany.mockResolvedValue({ count: 1 });

      const result = await service.claim(
        'cust-public',
        { version: 3 },
        { id: 'user-1', employeeId: 'emp-1' }
      );

      expect(result.version).toBe(4);
      expect(mockPrisma.customer.findFirst).toHaveBeenNthCalledWith(1, {
        where: { id: 'cust-public', deletedAt: null },
        select: { id: true },
      });
      expect(mockPrisma.customer.findUnique).toHaveBeenCalledWith({ where: { id: 'cust-public' } });
      expect(mockPrisma.customer.updateMany).toHaveBeenCalledWith({
        where: {
          id: 'cust-public',
          version: 3,
          deletedAt: null,
          chargerId: null,
        },
        data: expect.objectContaining({
          chargerId: 'emp-1',
          chargerName: null,
          version: { increment: 1 },
        }),
      });
    });

    it('请求开始时就不存在为 404；等待锁后消失/被认领/改版统一为 409', async () => {
      mockPrisma.customer.findFirst.mockResolvedValue(null);
      await expect(
        service.claim('missing', { version: 3 }, { id: 'user-1', employeeId: 'emp-1' })
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();

      vi.clearAllMocks();
      mockPrisma.approvalChangeRequest.findFirst.mockResolvedValue(null);
      mockPrisma.customer.findFirst.mockResolvedValue({ id: 'cust-public' });
      mockPrisma.customer.findUnique.mockResolvedValue(null);
      await expect(
        service.claim('cust-public', { version: 3 }, { id: 'user-1', employeeId: 'emp-1' })
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('确定性 barrier：锁等待期间被他人认领后，本请求返回 409 且绝不写入', async () => {
      let releaseLock!: () => void;
      const lockBarrier = new Promise<void>((resolve) => {
        releaseLock = resolve;
      });
      mockPrisma.customer.findFirst.mockResolvedValue({ id: 'cust-public' });
      mockPrisma.$executeRaw.mockImplementation(async () => lockBarrier);
      mockPrisma.customer.findUnique.mockResolvedValue(
        buildCustomer({ id: 'cust-public', chargerId: 'emp-other', version: 4 })
      );

      const pending = service.claim(
        'cust-public',
        { version: 3 },
        { id: 'user-1', employeeId: 'emp-1' }
      );
      await vi.waitFor(() => expect(mockPrisma.$executeRaw).toHaveBeenCalledTimes(1));
      expect(mockPrisma.customer.findUnique).not.toHaveBeenCalled();
      releaseLock();

      await expect(pending).rejects.toBeInstanceOf(ConflictException);
      expect(mockPrisma.customer.updateMany).not.toHaveBeenCalled();
    });
  });

  describe('versioned batch writes', () => {
    const operator = { id: 'user-1', employeeId: 'emp-operator' };

    it('先记录初始候选，固定顺序锁全部 id，再无 scope 核对真实快照并最后复验 scope', async () => {
      const rows = [
        buildCustomer({ id: 'cust-b', version: 3, deletedAt: null }),
        buildCustomer({ id: 'cust-a', version: 2, deletedAt: null }),
      ];
      mockPrisma.customer.findMany.mockResolvedValue(rows);
      mockPrisma.customer.updateMany.mockResolvedValue({ count: 1 });

      const result = await service.batchUpdate(
        {
          ids: ['cust-b', 'cust-a'],
          versions: { 'cust-a': 2, 'cust-b': 3 },
          patch: { customerLevel: 'A' },
        } as Parameters<typeof service.batchUpdate>[0],
        operator
      );

      expect(result).toEqual({ success: 2, skipped: [] });
      expect(mockPrisma.$executeRaw).toHaveBeenCalledTimes(2);
      expect(mockPrisma.customer.findMany).toHaveBeenNthCalledWith(1, {
        where: { id: { in: ['cust-b', 'cust-a'] } },
      });
      expect(mockPrisma.customer.findMany).toHaveBeenNthCalledWith(2, {
        where: { id: { in: ['cust-a', 'cust-b'] } },
      });
      expect(mockPrisma.customer.findMany).toHaveBeenNthCalledWith(3, {
        where: { id: { in: ['cust-a', 'cust-b'] }, deletedAt: null },
      });
      expect(mockPrisma.customer.updateMany).toHaveBeenNthCalledWith(1, {
        where: { id: 'cust-a', version: 2, deletedAt: null },
        data: expect.objectContaining({ customerLevel: 'A', version: { increment: 1 } }),
      });
      expect(mockPrisma.customer.updateMany).toHaveBeenNthCalledWith(2, {
        where: { id: 'cust-b', version: 3, deletedAt: null },
        data: expect.objectContaining({ customerLevel: 'A', version: { increment: 1 } }),
      });
    });

    it('锁后先核对全部原候选；后部 stale 时尚未开始任何写入', async () => {
      const initialRows = [
        buildCustomer({ id: 'cust-a', version: 1, deletedAt: null }),
        buildCustomer({ id: 'cust-b', version: 1, deletedAt: null }),
        buildCustomer({ id: 'cust-c', version: 1, deletedAt: null }),
      ];
      const lockedRows = [
        initialRows[0],
        buildCustomer({ id: 'cust-b', version: 2, deletedAt: null }),
        initialRows[2],
      ];
      mockPrisma.customer.findMany
        .mockResolvedValueOnce(initialRows)
        .mockResolvedValueOnce(lockedRows);

      await expect(
        service.batchUpdate(
          {
            ids: ['cust-a', 'cust-b', 'cust-c'],
            versions: { 'cust-a': 1, 'cust-b': 1, 'cust-c': 1 },
            patch: { customerSource: '转介绍' },
          } as Parameters<typeof service.batchUpdate>[0],
          operator
        )
      ).rejects.toBeInstanceOf(ConflictException);

      expect(mockPrisma.customer.updateMany).not.toHaveBeenCalled();
      expect(mockPrisma.customer.findMany).toHaveBeenCalledTimes(2);
    });

    it('确定性 barrier：等待锁后丢 scope 不能降级为 skipped，整批 409 且零写入', async () => {
      const initial = buildCustomer({
        id: 'cust-a',
        version: 5,
        chargerId: 'emp-owner',
        deletedAt: null,
      });
      const scopeLost = buildCustomer({
        ...initial,
        chargerId: 'emp-other',
        version: 5,
      });
      let releaseLock!: () => void;
      const lockBarrier = new Promise<void>((resolve) => {
        releaseLock = resolve;
      });
      mockPrisma.customer.findMany
        .mockResolvedValueOnce([initial])
        .mockResolvedValueOnce([scopeLost])
        .mockResolvedValueOnce([]);
      mockPrisma.$executeRaw.mockImplementation(async () => lockBarrier);

      const pending = service.batchRemove(
        { ids: ['cust-a'], versions: { 'cust-a': 5 } } as Parameters<typeof service.batchRemove>[0],
        operator,
        ['emp-owner'],
        'emp-self'
      );
      await vi.waitFor(() => expect(mockPrisma.$executeRaw).toHaveBeenCalledTimes(1));
      expect(mockPrisma.customer.findMany).toHaveBeenCalledTimes(1);
      releaseLock();

      await expect(pending).rejects.toBeInstanceOf(ConflictException);
      expect(mockPrisma.customer.findMany).toHaveBeenCalledTimes(3);
      expect(mockPrisma.customer.updateMany).not.toHaveBeenCalled();
    });

    it.each([
      {
        label: 'batchUpdate',
        prepare: () => undefined,
        run: () =>
          service.batchUpdate(
            {
              ids: ['cust-1'],
              versions: { 'cust-1': 5 },
              patch: { customerLevel: 'A' },
            } as Parameters<typeof service.batchUpdate>[0],
            operator
          ),
      },
      {
        label: 'batchTransfer',
        prepare: () => mockPrisma.employee.findUnique.mockResolvedValue({ id: 'emp-new' }),
        run: () =>
          service.batchTransfer(
            {
              ids: ['cust-1'],
              versions: { 'cust-1': 5 },
              chargerId: 'emp-new',
            } as Parameters<typeof service.batchTransfer>[0],
            operator
          ),
      },
      {
        label: 'batchAddCollaborators',
        prepare: () => mockPrisma.employee.findMany.mockResolvedValue([{ id: 'emp-collab' }]),
        run: () =>
          service.batchAddCollaborators(
            {
              ids: ['cust-1'],
              versions: { 'cust-1': 5 },
              collaboratorIds: ['emp-collab'],
            } as Parameters<typeof service.batchAddCollaborators>[0],
            operator
          ),
      },
      {
        label: 'batchRemoveCollaborators',
        prepare: () => undefined,
        run: () =>
          service.batchRemoveCollaborators(
            {
              ids: ['cust-1'],
              versions: { 'cust-1': 5 },
              collaboratorIds: ['emp-collab'],
            } as Parameters<typeof service.batchRemoveCollaborators>[0],
            operator
          ),
      },
      {
        label: 'batchRemove',
        prepare: () => undefined,
        run: () =>
          service.batchRemove(
            { ids: ['cust-1'], versions: { 'cust-1': 5 } } as Parameters<
              typeof service.batchRemove
            >[0],
            operator
          ),
      },
    ])('$label 对锁等待后软删的原候选统一 409', async ({ prepare, run }) => {
      const active = buildCustomer({ id: 'cust-1', version: 5, deletedAt: null });
      const deleted = buildCustomer({
        ...active,
        deletedAt: new Date('2026-08-24T00:00:00.000Z'),
      });
      prepare();
      mockPrisma.customer.findMany.mockResolvedValueOnce([active]).mockResolvedValueOnce([deleted]);

      await expect(run()).rejects.toBeInstanceOf(ConflictException);
      expect(mockPrisma.customer.updateMany).not.toHaveBeenCalled();
    });

    it('一开始就越权或不存在仍保持 success 0 + skipped，即使锁后能读到真实行', async () => {
      const hidden = buildCustomer({
        id: 'cust-hidden',
        version: 1,
        chargerId: 'emp-other',
        deletedAt: null,
      });
      mockPrisma.customer.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([hidden]);

      const result = await service.batchRemove(
        { ids: ['cust-hidden'], versions: { 'cust-hidden': 1 } } as Parameters<
          typeof service.batchRemove
        >[0],
        operator,
        ['emp-owner'],
        'emp-self'
      );

      expect(result).toEqual({ success: 0, skipped: ['cust-hidden'] });
      expect(mockPrisma.customer.findMany).toHaveBeenCalledTimes(2);
      expect(mockPrisma.customer.findMany.mock.calls[1]?.[0]?.where).toEqual({
        id: { in: ['cust-hidden'] },
      });
      expect(mockPrisma.customer.updateMany).not.toHaveBeenCalled();
    });

    it('初始越权客户即使有 pending 也只 skipped，审批查询仅覆盖初始可见候选', async () => {
      const visible = buildCustomer({
        id: 'cust-visible',
        version: 2,
        chargerId: 'emp-owner',
        deletedAt: null,
      });
      const hidden = buildCustomer({
        id: 'cust-hidden',
        version: 9,
        chargerId: 'emp-other',
        deletedAt: null,
      });
      mockPrisma.customer.findMany
        .mockResolvedValueOnce([visible])
        .mockResolvedValueOnce([hidden, visible])
        .mockResolvedValueOnce([visible]);
      mockPrisma.approvalChangeRequest.findFirst.mockImplementation(
        async (args: { where: { targetId: { in: string[] } } }) =>
          args.where.targetId.in.includes('cust-hidden')
            ? {
                id: 'hidden-pending',
                targetId: 'cust-hidden',
                title: '不可泄漏的隐藏客户审批标题',
              }
            : null
      );

      const result = await service.batchRemove(
        {
          ids: ['cust-hidden', 'cust-visible'],
          versions: { 'cust-hidden': 9, 'cust-visible': 2 },
        } as Parameters<typeof service.batchRemove>[0],
        operator,
        ['emp-owner'],
        'emp-self'
      );

      expect(result).toEqual({ success: 1, skipped: ['cust-hidden'] });
      expect(mockPrisma.$executeRaw).toHaveBeenCalledTimes(2);
      expect(mockPrisma.approvalChangeRequest.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ targetId: { in: ['cust-visible'] } }),
        })
      );
      expect(mockPrisma.customer.updateMany).toHaveBeenCalledTimes(1);
    });

    it('pending 审批在锁内统一抛 ConflictException/409', async () => {
      const row = buildCustomer({ id: 'cust-1', version: 1, deletedAt: null });
      mockPrisma.customer.findMany.mockResolvedValue([row]);
      mockPrisma.approvalChangeRequest.findFirst.mockResolvedValue({
        id: 'pending-1',
        targetId: 'cust-1',
        title: '线索阶段变更',
      });

      await expect(
        service.batchRemove(
          { ids: ['cust-1'], versions: { 'cust-1': 1 } } as Parameters<
            typeof service.batchRemove
          >[0],
          operator
        )
      ).rejects.toBeInstanceOf(ConflictException);
      expect(mockPrisma.customer.updateMany).not.toHaveBeenCalled();
    });

    it('五类 batch 都消费逐行 version 并执行最终 CAS', async () => {
      const scenarios: Array<{
        prepare?: () => void;
        run: () => Promise<{ success: number; skipped: string[] }>;
      }> = [
        {
          prepare: () => mockPrisma.employee.findUnique.mockResolvedValue({ id: 'emp-new' }),
          run: () =>
            service.batchTransfer(
              {
                ids: ['cust-1'],
                versions: { 'cust-1': 5 },
                chargerId: 'emp-new',
              } as Parameters<typeof service.batchTransfer>[0],
              operator
            ),
        },
        {
          run: () =>
            service.batchUpdate(
              {
                ids: ['cust-1'],
                versions: { 'cust-1': 5 },
                patch: { customerRelationship: '长期合作' },
              } as Parameters<typeof service.batchUpdate>[0],
              operator
            ),
        },
        {
          prepare: () => mockPrisma.employee.findMany.mockResolvedValue([{ id: 'emp-new' }]),
          run: () =>
            service.batchAddCollaborators(
              {
                ids: ['cust-1'],
                versions: { 'cust-1': 5 },
                collaboratorIds: ['emp-new'],
              } as Parameters<typeof service.batchAddCollaborators>[0],
              operator
            ),
        },
        {
          run: () =>
            service.batchRemoveCollaborators(
              {
                ids: ['cust-1'],
                versions: { 'cust-1': 5 },
                collaboratorIds: ['emp-old'],
              } as Parameters<typeof service.batchRemoveCollaborators>[0],
              operator
            ),
        },
        {
          run: () =>
            service.batchRemove(
              { ids: ['cust-1'], versions: { 'cust-1': 5 } } as Parameters<
                typeof service.batchRemove
              >[0],
              operator
            ),
        },
      ];

      for (const scenario of scenarios) {
        vi.clearAllMocks();
        mockPrisma.approvalChangeRequest.findFirst.mockResolvedValue(null);
        const row = {
          ...buildCustomer({ id: 'cust-1', version: 5, deletedAt: null }),
          collaboratorIds: ['emp-old', 'emp-new'],
        };
        mockPrisma.customer.findMany.mockResolvedValue([row]);
        mockPrisma.customer.updateMany.mockResolvedValue({ count: 1 });
        scenario.prepare?.();

        await expect(scenario.run()).resolves.toEqual({ success: 1, skipped: [] });
        expect(mockPrisma.customer.updateMany).toHaveBeenCalledWith(
          expect.objectContaining({
            where: { id: 'cust-1', version: 5, deletedAt: null },
            data: expect.objectContaining({ version: { increment: 1 } }),
          })
        );
      }
    });

    it('最终 CAS count 漂移抛 409；事务不允许返回部分 success', async () => {
      const rows = [
        buildCustomer({ id: 'cust-a', version: 1, deletedAt: null }),
        buildCustomer({ id: 'cust-b', version: 1, deletedAt: null }),
      ];
      mockPrisma.customer.findMany.mockResolvedValue(rows);
      mockPrisma.customer.updateMany
        .mockResolvedValueOnce({ count: 1 })
        .mockResolvedValueOnce({ count: 0 });

      await expect(
        service.batchUpdate(
          {
            ids: ['cust-a', 'cust-b'],
            versions: { 'cust-a': 1, 'cust-b': 1 },
            patch: { customerSource: '转介绍' },
          } as Parameters<typeof service.batchUpdate>[0],
          operator
        )
      ).rejects.toBeInstanceOf(ConflictException);
      expect(mockPrisma.customer.updateMany).toHaveBeenCalledTimes(2);
    });
  });

  describe('checkDuplicates', () => {
    it('should search all active customers without charger scope', async () => {
      const updatedAt = new Date('2026-05-08T00:00:00Z');
      mockPrisma.customer.findMany.mockResolvedValue([
        {
          ...buildCustomer({
            id: 'cust-dup',
            customerName: '示例科技',
            chargerId: 'emp-1',
            chargerName: '张三',
            updatedAt,
          }),
          charger: { name: '张三' },
          contacts: [],
        },
      ]);

      const result = await service.checkDuplicates({ customerName: '示例科技' });

      expect(result.total).toBe(1);
      expect(result.items[0]).toEqual(
        expect.objectContaining({
          id: 'cust-dup',
          pool: 'private',
          matchedFields: ['customerName'],
          chargerName: '张三',
          updatedAt: updatedAt.toISOString(),
        })
      );
      expect(mockPrisma.customer.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            deletedAt: null,
            OR: [
              {
                AND: [{ customerName: { contains: '示例科技', mode: 'insensitive' } }],
              },
              {
                AND: [{ shortName: { contains: '示例科技', mode: 'insensitive' } }],
              },
            ],
          },
          take: 20,
        })
      );
    });

    it('should split whitespace-separated keywords into AND-contains tokens', async () => {
      mockPrisma.customer.findMany.mockResolvedValue([]);

      await service.checkDuplicates({ customerName: '示例 科技' });

      expect(mockPrisma.customer.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            deletedAt: null,
            OR: [
              {
                AND: [
                  { customerName: { contains: '示例', mode: 'insensitive' } },
                  { customerName: { contains: '科技', mode: 'insensitive' } },
                ],
              },
              {
                AND: [
                  { shortName: { contains: '示例', mode: 'insensitive' } },
                  { shortName: { contains: '科技', mode: 'insensitive' } },
                ],
              },
            ],
          },
        })
      );
    });

    it('should match public pool customers by contact phone', async () => {
      mockPrisma.customer.findMany.mockResolvedValue([
        {
          ...buildCustomer({
            id: 'cust-public',
            customerName: '公海客户',
            chargerId: null,
          }),
          charger: null,
          contacts: [{ mobile: '13800138000', phone: null }],
        },
      ]);

      const result = await service.checkDuplicates({ phone: '138 0013 8000' });

      expect(result.items[0]).toEqual(
        expect.objectContaining({
          id: 'cust-public',
          pool: 'public',
          matchedFields: ['contactPhone'],
        })
      );
      expect(mockPrisma.customer.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            deletedAt: null,
            OR: expect.arrayContaining([
              {
                contacts: {
                  some: expect.objectContaining({
                    deletedAt: null,
                  }),
                },
              },
            ]),
          }),
        })
      );
    });

    it('should mark accessible by charger scope / collaborator / public pool', async () => {
      // 第一次 findMany：查重候选；第二次 findMany：accessible 范围过滤
      mockPrisma.customer.findMany
        .mockResolvedValueOnce([
          {
            ...buildCustomer({ id: 'cust-mine', customerName: '示例科技', chargerId: 'emp-1' }),
            charger: { name: '我' },
            contacts: [],
          },
          {
            ...buildCustomer({
              id: 'cust-others',
              customerName: '示例科技分公司',
              chargerId: 'emp-2',
            }),
            charger: { name: '别人' },
            contacts: [],
          },
          {
            ...buildCustomer({ id: 'cust-public', customerName: '示例科技集团', chargerId: null }),
            charger: null,
            contacts: [],
          },
        ])
        .mockResolvedValueOnce([{ id: 'cust-mine' }, { id: 'cust-public' }]);

      const result = await service.checkDuplicates(
        { customerName: '示例科技' },
        { chargerScope: ['emp-1'], currentEmployeeId: 'user-1' }
      );

      const accessibleById = Object.fromEntries(
        result.items.map((item) => [item.id, item.accessible])
      );
      expect(accessibleById).toEqual({
        'cust-mine': true,
        'cust-others': false,
        'cust-public': true,
      });
      // 范围过滤查询的口径必须与 GET /:id（含公海）一致
      expect(mockPrisma.customer.findMany).toHaveBeenLastCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            id: { in: ['cust-mine', 'cust-others', 'cust-public'] },
            deletedAt: null,
            OR: [
              { chargerId: { in: ['emp-1'] } },
              { collaboratorIds: { array_contains: ['user-1'] } },
              { chargerId: null },
            ],
          }),
        })
      );
    });

    it('should mark all accessible for full-scope role without extra query', async () => {
      mockPrisma.customer.findMany.mockResolvedValue([
        {
          ...buildCustomer({ id: 'cust-dup', customerName: '示例科技', chargerId: 'emp-2' }),
          charger: { name: '别人' },
          contacts: [],
        },
      ]);

      const result = await service.checkDuplicates(
        { customerName: '示例科技' },
        { chargerScope: null, currentEmployeeId: 'user-1' }
      );

      expect(result.items[0]?.accessible).toBe(true);
      expect(mockPrisma.customer.findMany).toHaveBeenCalledTimes(1);
    });

    it('should mark all inaccessible when access context is missing', async () => {
      mockPrisma.customer.findMany.mockResolvedValue([
        {
          ...buildCustomer({ id: 'cust-public', customerName: '示例科技', chargerId: null }),
          charger: null,
          contacts: [],
        },
      ]);

      const result = await service.checkDuplicates({ customerName: '示例科技' });

      expect(result.items[0]?.accessible).toBe(false);
      expect(mockPrisma.customer.findMany).toHaveBeenCalledTimes(1);
    });

    it('should exclude current customer when excludeId is provided', async () => {
      mockPrisma.customer.findMany.mockResolvedValue([]);

      await service.checkDuplicates({ customerName: '示例科技', excludeId: 'cust-current' });

      expect(mockPrisma.customer.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            id: { not: 'cust-current' },
          }),
        })
      );
    });
  });

  describe('permanentRemove', () => {
    function mockNoChildren() {
      mockPrisma.contact.count.mockResolvedValue(0);
      mockPrisma.opportunity.count.mockResolvedValue(0);
      mockPrisma.saleOrder.count.mockResolvedValue(0);
      mockPrisma.payment.count.mockResolvedValue(0);
      mockPrisma.invoice.count.mockResolvedValue(0);
      mockPrisma.keepRecord.count.mockResolvedValue(0);
      mockPrisma.visitRecord.count.mockResolvedValue(0);
    }

    it('物删最终绑定调用方 version，不用 service 读取到的最新版本代替确认', async () => {
      const customer = buildCustomer({ id: 'cust-1', version: 7, deletedAt: new Date() });
      mockPrisma.customer.findUnique.mockResolvedValue(customer);
      mockPrisma.customer.delete.mockResolvedValue(customer);
      mockNoChildren();

      await service.permanentRemove('cust-1', { version: 7 });

      expect(mockPrisma.customer.findUnique).toHaveBeenCalledTimes(2);
      expect(mockPrisma.customer.delete).toHaveBeenCalledWith({
        where: { id: 'cust-1', version: 7, deletedAt: { not: null } },
      });
    });

    it('请求开始时不存在为 404；调用方 stale 或当前非软删统一为 409', async () => {
      mockPrisma.customer.findUnique.mockResolvedValue(null);
      await expect(service.permanentRemove('non-exist', { version: 1 })).rejects.toBeInstanceOf(
        NotFoundException
      );

      vi.clearAllMocks();
      mockPrisma.customer.findUnique.mockResolvedValue(
        buildCustomer({ id: 'cust-1', version: 8, deletedAt: new Date() })
      );
      await expect(service.permanentRemove('cust-1', { version: 7 })).rejects.toBeInstanceOf(
        ConflictException
      );
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();

      vi.clearAllMocks();
      mockPrisma.customer.findUnique.mockResolvedValue(
        buildCustomer({ id: 'cust-1', version: 7, deletedAt: null })
      );
      await expect(service.permanentRemove('cust-1', { version: 7 })).rejects.toBeInstanceOf(
        ConflictException
      );
    });

    it('等待锁后删除状态变化返回 409，不扫描子记录也不物删', async () => {
      const deleted = buildCustomer({ id: 'cust-1', version: 7, deletedAt: new Date() });
      const restored = buildCustomer({ ...deleted, version: 8, deletedAt: null });
      mockPrisma.customer.findUnique.mockResolvedValueOnce(deleted).mockResolvedValueOnce(restored);

      await expect(service.permanentRemove('cust-1', { version: 7 })).rejects.toBeInstanceOf(
        ConflictException
      );
      expect(mockPrisma.contact.count).not.toHaveBeenCalled();
      expect(mockPrisma.customer.delete).not.toHaveBeenCalled();
    });

    it('P1-14: 仍有子记录（含 deletedAt 软删）时抛 409 不物删', async () => {
      const customer = buildCustomer({ id: 'cust-1', version: 7, deletedAt: new Date() });
      mockPrisma.customer.findUnique.mockResolvedValue(customer);
      mockPrisma.contact.count.mockResolvedValue(3);
      mockPrisma.opportunity.count.mockResolvedValue(1);
      mockPrisma.saleOrder.count.mockResolvedValue(0);
      mockPrisma.payment.count.mockResolvedValue(0);
      mockPrisma.invoice.count.mockResolvedValue(0);
      mockPrisma.keepRecord.count.mockResolvedValue(2);
      mockPrisma.visitRecord.count.mockResolvedValue(0);

      await expect(service.permanentRemove('cust-1', { version: 7 })).rejects.toBeInstanceOf(
        ConflictException
      );
      expect(mockPrisma.customer.delete).not.toHaveBeenCalled();
      expect(mockPrisma.contact.count).toHaveBeenCalledWith({ where: { customerId: 'cust-1' } });
    });
  });

  describe('findAllForSelection', () => {
    it('should return customers for dropdown sorted by updatedAt desc', async () => {
      const now = new Date('2026-05-01T00:00:00Z');
      mockPrisma.customer.findMany.mockResolvedValue([
        { id: '1', serialNumber: 'KH001', customerName: '客户A', updatedAt: now },
      ]);

      const result = await service.findAllForSelection();

      // 应用层 strip 掉 updatedAt 后返回纯下拉 payload
      expect(result).toEqual([{ id: '1', serialNumber: 'KH001', customerName: '客户A' }]);
      expect(mockPrisma.customer.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { deletedAt: null },
          orderBy: { updatedAt: 'desc' },
          select: { id: true, serialNumber: true, customerName: true, updatedAt: true },
          take: 200,
        })
      );
    });

    it('should support keyword filter in selection', async () => {
      mockPrisma.customer.findMany.mockResolvedValue([]);

      await service.findAllForSelection('关键词');

      expect(mockPrisma.customer.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            OR: [
              { customerName: { contains: '关键词', mode: 'insensitive' } },
              { serialNumber: { contains: '关键词', mode: 'insensitive' } },
            ],
          }),
        })
      );
    });

    it('should rerank by similarity tier when keyword present', async () => {
      const now = new Date('2026-05-01T00:00:00Z');
      const earlier = new Date('2026-04-01T00:00:00Z');
      // 模拟数据库返回（已按 updatedAt desc 预排）
      mockPrisma.customer.findMany.mockResolvedValue([
        // 仅 serialNumber 命中"南威"（无可能但占位测试 tier 3）
        { id: '3', serialNumber: 'KH南威', customerName: '其他客户', updatedAt: now },
        // contains 命中（非前缀）
        { id: '2', serialNumber: 'KH002', customerName: '福建南威软件', updatedAt: now },
        // startsWith 命中
        { id: '1', serialNumber: 'KH001', customerName: '南威集团', updatedAt: earlier },
      ]);

      const result = await service.findAllForSelection('南威');

      // 顺序：startsWith(1) → contains(2) → 仅 serialNumber 命中(3)
      expect(result.map((c) => c.id)).toEqual(['1', '2', '3']);
    });
  });
});
