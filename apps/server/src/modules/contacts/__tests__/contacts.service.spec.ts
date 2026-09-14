import { ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { vi } from 'vitest';

import type { FilterApplierService } from '../../../common/filter-scheme';
import { buildContact } from '../../../test/factories';
import {
  asPrismaService,
  createMockPrismaService,
  type MockPrismaService,
} from '../../../test/prisma-mock.factory';
import { ContactsService } from '../contacts.service';

function buildContactWithCustomer(overrides = {}) {
  const contact = buildContact(overrides);
  return {
    ...contact,
    customer: { id: contact.customerId, customerName: '测试客户', shortName: null },
  };
}

describe('ContactsService', () => {
  let service: ContactsService;
  let mockPrisma: MockPrismaService;
  let mockFilterApplier: { buildWhere: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    mockPrisma = createMockPrismaService();

    mockFilterApplier = {
      buildWhere: vi.fn().mockResolvedValue({ deletedAt: null }),
    };

    service = new ContactsService(
      asPrismaService(mockPrisma),
      mockFilterApplier as unknown as FilterApplierService
    );
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('findAll', () => {
    it('should return paginated contacts with default params', async () => {
      const contacts = [
        {
          ...buildContactWithCustomer(),
          creator: { name: '王创建' },
          updater: { name: '张修改' },
        },
        { ...buildContactWithCustomer(), creator: null, updater: null },
      ];
      mockPrisma.contact.findMany.mockResolvedValue(contacts);
      mockPrisma.contact.count.mockResolvedValue(2);

      const result = await service.findAll({ page: 1, pageSize: 10, sortOrder: 'desc' });

      expect(result.items).toHaveLength(2);
      expect(result.total).toBe(2);
      expect(result.page).toBe(1);
      expect(result.pageSize).toBe(10);
      expect(result.totalPages).toBe(1);
      expect(result.items.map((item) => item.createdBy)).toEqual(['王创建', null]);
      expect(result.items.map((item) => item.updatedBy)).toEqual(['张修改', null]);
      expect(mockPrisma.contact.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          skip: 0,
          take: 10,
          where: { deletedAt: null },
          orderBy: { createdAt: 'desc' },
          include: expect.objectContaining({
            creator: { select: { name: true } },
            updater: { select: { name: true } },
          }),
        })
      );
    });

    it('should forward keyword to FilterApplier (legacyKeyword)', async () => {
      mockPrisma.contact.findMany.mockResolvedValue([]);
      mockPrisma.contact.count.mockResolvedValue(0);

      await service.findAll({ keyword: '张三', page: 1, pageSize: 10, sortOrder: 'desc' });

      expect(mockFilterApplier.buildWhere).toHaveBeenCalledWith(
        expect.objectContaining({ legacyKeyword: '张三' })
      );
    });

    it('should forward customerId to FilterApplier (legacyFilters)', async () => {
      mockPrisma.contact.findMany.mockResolvedValue([]);
      mockPrisma.contact.count.mockResolvedValue(0);

      await service.findAll({ customerId: ['cust-1'], page: 1, pageSize: 10, sortOrder: 'desc' });

      expect(mockFilterApplier.buildWhere).toHaveBeenCalledWith(
        expect.objectContaining({
          legacyFilters: expect.objectContaining({ customerId: ['cust-1'] }),
        })
      );
    });

    it('should forward status to FilterApplier (legacyFilters)', async () => {
      mockPrisma.contact.findMany.mockResolvedValue([]);
      mockPrisma.contact.count.mockResolvedValue(0);

      await service.findAll({ status: 'active', page: 1, pageSize: 10, sortOrder: 'desc' });

      expect(mockFilterApplier.buildWhere).toHaveBeenCalledWith(
        expect.objectContaining({
          legacyFilters: expect.objectContaining({ status: 'active' }),
        })
      );
    });

    it('should include customer relation', async () => {
      mockPrisma.contact.findMany.mockResolvedValue([]);
      mockPrisma.contact.count.mockResolvedValue(0);

      await service.findAll({ page: 1, pageSize: 10, sortOrder: 'desc' });

      expect(mockPrisma.contact.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          include: expect.objectContaining({
            customer: expect.anything(),
          }),
        })
      );
    });

    it('should expose public-pool customer contacts (customer.chargerId=NULL) to non-owners', async () => {
      // 与 keep-records 同语义（2026-06-04 放宽）：公海客户的联系人对所有 view 权限可见。
      // 通过 applyCustomerOwnedScope 注入的 baseWhere.OR 应包含 { customer: { chargerId: null } }。
      mockPrisma.contact.findMany.mockResolvedValue([]);
      mockPrisma.contact.count.mockResolvedValue(0);

      await service.findAll({ page: 1, pageSize: 10, sortOrder: 'desc' }, ['emp-B']);

      const call = mockFilterApplier.buildWhere.mock.calls[0]![0] as {
        baseWhere: { OR?: Array<Record<string, unknown>> };
      };
      expect(call.baseWhere.OR).toContainEqual({ customer: { chargerId: null } });
    });
  });

  describe('findAllForSelection', () => {
    it('should return contacts for dropdown', async () => {
      mockPrisma.contact.findMany.mockResolvedValue([
        { id: '1', contactName: '张三', position: '经理', phone: '13900001234' },
      ]);

      const result = await service.findAllForSelection({});

      expect(result).toHaveLength(1);
      expect(mockPrisma.contact.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { deletedAt: null },
          select: { id: true, contactName: true, position: true, phone: true },
        })
      );
    });

    it('should filter by keyword and customerId', async () => {
      mockPrisma.contact.findMany.mockResolvedValue([]);

      await service.findAllForSelection({ keyword: '张', customerId: 'cust-1' });

      expect(mockPrisma.contact.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            customerId: 'cust-1',
            OR: [
              { contactName: { contains: '张', mode: 'insensitive' } },
              { phone: { contains: '张', mode: 'insensitive' } },
            ],
          }),
        })
      );
    });
  });

  describe('findOne', () => {
    it('should return a contact with customer, creator and updater includes', async () => {
      const contact = {
        ...buildContactWithCustomer({ id: 'contact-1' }),
        creator: { name: '王创建' },
        updater: { name: '李修改' },
      };
      mockPrisma.contact.findFirst.mockResolvedValue(contact);

      const result = await service.findOne('contact-1');

      expect(result).toMatchObject({ createdBy: '王创建', updatedBy: '李修改' });
      expect(mockPrisma.contact.findFirst).toHaveBeenCalledWith({
        where: { id: 'contact-1', deletedAt: null },
        include: expect.objectContaining({
          customer: expect.anything(),
          creator: { select: { name: true } },
          updater: { select: { name: true } },
        }),
      });
    });

    it('should throw NotFoundException when contact does not exist', async () => {
      mockPrisma.contact.findFirst.mockResolvedValue(null);

      await expect(service.findOne('non-exist')).rejects.toThrow(NotFoundException);
    });
  });

  describe('create', () => {
    it('should create contact with customer, creator and updater includes', async () => {
      const contact = buildContactWithCustomer();
      // 新增数据范围校验：写入前 assertCustomerInScope 会查目标客户是否在范围内。
      // mock 命中目标客户（在范围内、未软删），放行后才会执行 contact.create。
      mockPrisma.customer.findFirst.mockResolvedValue({ id: 'cust-1' });
      mockPrisma.contact.create.mockResolvedValue(contact);

      const result = await service.create(
        { contactName: '新联系人', customerId: 'cust-1' } as Parameters<typeof service.create>[0],
        { id: 'user-1', employeeId: 'emp-' + 'user-1' }
      );

      expect(result).toBeDefined();
      // 断言写入前做了数据范围校验：按目标 customerId 查未软删客户
      expect(mockPrisma.customer.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ id: 'cust-1', deletedAt: null }),
        })
      );
      expect(mockPrisma.contact.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            contactName: '新联系人',
            customerId: 'cust-1',
          }),
          include: expect.objectContaining({
            customer: expect.anything(),
          }),
        })
      );
    });
  });

  describe('update', () => {
    it('should update contact with version check', async () => {
      const existing = buildContactWithCustomer({ id: 'contact-1', version: 1 });
      mockPrisma.contact.findFirst.mockResolvedValue(existing);
      mockPrisma.contact.update.mockResolvedValue({ ...existing, version: 2 });

      await service.update(
        'contact-1',
        { contactName: '更新名称', version: 1 } as Parameters<typeof service.update>[1],
        { id: 'user-1', employeeId: 'emp-' + 'user-1' }
      );

      expect(mockPrisma.contact.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'contact-1', version: 1 },
          data: expect.objectContaining({
            contactName: '更新名称',
            version: { increment: 1 },
          }),
        })
      );
    });

    it('should throw ConflictException on P2025 error (optimistic lock)', async () => {
      const existing = buildContactWithCustomer({ id: 'contact-1', version: 1 });
      mockPrisma.contact.findFirst.mockResolvedValue(existing);

      const prismaError = new Prisma.PrismaClientKnownRequestError('', {
        code: 'P2025',
        clientVersion: '0',
      });
      mockPrisma.contact.update.mockRejectedValue(prismaError);

      await expect(
        service.update(
          'contact-1',
          { contactName: '冲突', version: 1 } as Parameters<typeof service.update>[1],
          { id: 'user-1', employeeId: 'emp-' + 'user-1' }
        )
      ).rejects.toThrow(ConflictException);
    });

    it('should re-throw non-P2025 errors', async () => {
      const existing = buildContactWithCustomer({ id: 'contact-1' });
      mockPrisma.contact.findFirst.mockResolvedValue(existing);
      mockPrisma.contact.update.mockRejectedValue(new Error('DB connection lost'));

      await expect(
        service.update(
          'contact-1',
          { contactName: '更新' } as Parameters<typeof service.update>[1],
          { id: 'user-1', employeeId: 'emp-' + 'user-1' }
        )
      ).rejects.toThrow('DB connection lost');
    });
  });

  describe('remove', () => {
    it('should soft delete by setting deletedAt', async () => {
      const contact = buildContactWithCustomer({ id: 'contact-1' });
      mockPrisma.contact.findFirst.mockResolvedValue(contact);
      mockPrisma.contact.update.mockResolvedValue(contact);

      await service.remove('contact-1', { id: 'user-1', employeeId: 'emp-' + 'user-1' });

      expect(mockPrisma.contact.update).toHaveBeenCalledWith({
        where: { id: 'contact-1' },
        data: expect.objectContaining({
          deletedAt: expect.any(Date),
        }),
      });
    });

    it('should throw NotFoundException when contact does not exist', async () => {
      mockPrisma.contact.findFirst.mockResolvedValue(null);

      await expect(
        service.remove('non-exist', { id: 'user-1', employeeId: 'emp-' + 'user-1' })
      ).rejects.toThrow(NotFoundException);
    });
  });
});
