import { vi } from 'vitest';

import {
  asPrismaService,
  createMockPrismaService,
  type MockPrismaService,
} from '../../../test/prisma-mock.factory';
import { OperationLogsService } from '../operation-logs.service';

describe('OperationLogsService', () => {
  let service: OperationLogsService;
  let mockPrisma: MockPrismaService;

  beforeEach(() => {
    mockPrisma = createMockPrismaService();
    service = new OperationLogsService(asPrismaService(mockPrisma));
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ---------------------------------------------------------------------------
  // log
  // ---------------------------------------------------------------------------
  describe('log', () => {
    it('should create an operation log with JSON details via toJsonValue', async () => {
      const details = { before: { name: 'old' }, after: { name: 'new' } };
      const logData = {
        userId: 'user-1',
        ipAddress: '192.168.1.1',
        module: 'customers',
        action: 'UPDATE',
        target: 'customer-123',
        details,
      };

      const createdRecord = {
        id: 'log-1',
        ...logData,
        createdAt: new Date('2026-01-01T00:00:00Z'),
      };
      mockPrisma.operationLog.create.mockResolvedValueOnce(createdRecord);

      const result = await service.log(logData);

      expect(result).toEqual(createdRecord);
      expect(mockPrisma.operationLog.create).toHaveBeenCalledWith({
        data: {
          employeeId: null,
          ipAddress: '192.168.1.1',
          module: 'customers',
          action: 'UPDATE',
          target: 'customer-123',
          // 2026-06-16 投影改造：log() 始终写 targetCustomerId（null 表示非 CRM）
          targetCustomerId: null,
          details,
        },
      });
    });
  });

  // ---------------------------------------------------------------------------
  // findAll
  // ---------------------------------------------------------------------------
  describe('findAll', () => {
    /** Helper: build a mock operationLog row returned by Prisma */
    function buildOperationLogRow(overrides: Record<string, unknown> = {}) {
      return {
        id: 'log-1',
        employeeId: 'user-1',
        ipAddress: '10.0.0.1',
        module: 'customers',
        action: 'CREATE',
        target: 'customer-1',
        details: null,
        createdAt: new Date('2026-01-15T10:00:00Z'),
        employee: { id: 'user-1', username: 'admin', name: '管理员' },
        ...overrides,
      };
    }

    it('should return paginated results with default page=1 pageSize=10', async () => {
      const row = buildOperationLogRow();
      mockPrisma.operationLog.findMany.mockResolvedValueOnce([row]);
      mockPrisma.operationLog.count.mockResolvedValueOnce(1);

      const result = await service.findAll({});

      expect(result.page).toBe(1);
      expect(result.pageSize).toBe(10);
      expect(result.total).toBe(1);
      expect(result.totalPages).toBe(1);
      expect(result.items).toHaveLength(1);

      // verify skip/take passed to Prisma
      expect(mockPrisma.operationLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 0, take: 10 })
      );
    });

    it('should filter by employeeId', async () => {
      mockPrisma.operationLog.findMany.mockResolvedValueOnce([]);
      mockPrisma.operationLog.count.mockResolvedValueOnce(0);

      await service.findAll({ employeeId: 'emp-99' });

      expect(mockPrisma.operationLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ employeeId: 'emp-99' }),
        })
      );
    });

    it('should filter by module', async () => {
      mockPrisma.operationLog.findMany.mockResolvedValueOnce([]);
      mockPrisma.operationLog.count.mockResolvedValueOnce(0);

      await service.findAll({ module: ['opportunities'] });

      expect(mockPrisma.operationLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ module: { in: ['opportunities'] } }),
        })
      );
    });

    it('should filter by action', async () => {
      mockPrisma.operationLog.findMany.mockResolvedValueOnce([]);
      mockPrisma.operationLog.count.mockResolvedValueOnce(0);

      await service.findAll({ action: ['DELETE'] });

      expect(mockPrisma.operationLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ action: { in: ['DELETE'] } }),
        })
      );
    });

    it('should filter by target and details kind', async () => {
      mockPrisma.operationLog.findMany.mockResolvedValueOnce([]);
      mockPrisma.operationLog.count.mockResolvedValueOnce(0);

      await service.findAll({ target: 'customer-1', kind: 'change' });

      expect(mockPrisma.operationLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            target: 'customer-1',
            details: { path: ['kind'], equals: 'change' },
          }),
        })
      );
    });

    it('should filter by date range with startDate (gte) and endDate (lte)', async () => {
      mockPrisma.operationLog.findMany.mockResolvedValueOnce([]);
      mockPrisma.operationLog.count.mockResolvedValueOnce(0);

      await service.findAll({
        startDate: '2026-01-01T00:00:00Z',
        endDate: '2026-01-31T23:59:59Z',
      });

      const calledWhere = mockPrisma.operationLog.findMany.mock.calls[0]![0].where;
      expect(calledWhere.createdAt).toEqual({
        gte: new Date('2026-01-01T00:00:00Z'),
        lte: new Date('2026-01-31T23:59:59Z'),
      });
    });

    it('should append T23:59:59.999Z to endDate when no time component is provided', async () => {
      mockPrisma.operationLog.findMany.mockResolvedValueOnce([]);
      mockPrisma.operationLog.count.mockResolvedValueOnce(0);

      await service.findAll({ endDate: '2026-01-31' });

      const calledWhere = mockPrisma.operationLog.findMany.mock.calls[0]![0].where;
      expect(calledWhere.createdAt).toEqual({
        lte: new Date('2026-01-31T23:59:59.999Z'),
      });
    });

    it('should map field aliases (content, operator, operationType, operationDesc, operatorIp, beforeData, afterData)', async () => {
      const row = buildOperationLogRow({
        details: {
          targetName: '示例科技',
          before: { status: 'draft' },
          after: { status: 'active' },
        },
      });
      mockPrisma.operationLog.findMany.mockResolvedValueOnce([row]);
      mockPrisma.operationLog.count.mockResolvedValueOnce(1);

      const result = await service.findAll({});
      const item = result.items[0];

      // Field alias assertions
      expect(item).toHaveProperty('userId', 'user-1');
      expect(item).toHaveProperty('content', '示例科技');
      expect(item).toHaveProperty('operator', '管理员');
      expect(item).toHaveProperty('operatorName', '管理员');
      expect(item).toHaveProperty('operatorUsername', 'admin');
      expect(item).toHaveProperty('operatorId', 'user-1');
      expect(item).toHaveProperty('operationType', 'CREATE');
      expect(item).toHaveProperty('operationDesc', '示例科技');
      expect(item).toHaveProperty('operatorIp', '10.0.0.1');
      expect(item).toHaveProperty('targetId', 'customer-1');
      expect(item).toHaveProperty('targetName', '示例科技');
      expect(item).toHaveProperty('beforeData', { status: 'draft' });
      expect(item).toHaveProperty('afterData', { status: 'active' });
    });
  });

  // ---------------------------------------------------------------------------
  // findLoginLogs
  // ---------------------------------------------------------------------------
  describe('findLoginLogs', () => {
    /** Helper: build a mock loginLog row */
    function buildLoginLogRow(overrides: Record<string, unknown> = {}) {
      return {
        id: 'login-1',
        userId: 'user-1',
        username: 'admin',
        actionType: 'LOGIN',
        status: 'SUCCESS',
        ipAddress: '10.0.0.1',
        userAgent: 'Mozilla/5.0',
        createdAt: new Date('2026-01-15T08:00:00Z'),
        ...overrides,
      };
    }

    it('should return paginated results with default page=1 pageSize=10', async () => {
      const row = buildLoginLogRow({ employeeId: 'user-1', employee: { name: '管理员' } });
      mockPrisma.loginLog.findMany.mockResolvedValueOnce([row]);
      mockPrisma.loginLog.count.mockResolvedValueOnce(1);

      const result = await service.findLoginLogs({});

      expect(result.page).toBe(1);
      expect(result.pageSize).toBe(10);
      expect(result.total).toBe(1);
      expect(result.totalPages).toBe(1);
      expect(result.items).toHaveLength(1);
      expect(result.items[0]).toHaveProperty('employeeName', '管理员');

      expect(mockPrisma.loginLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 0, take: 10 })
      );
    });

    it('should filter by employeeId', async () => {
      mockPrisma.loginLog.findMany.mockResolvedValueOnce([]);
      mockPrisma.loginLog.count.mockResolvedValueOnce(0);

      await service.findLoginLogs({ employeeId: 'emp-42' });

      expect(mockPrisma.loginLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ employeeId: 'emp-42' }),
        })
      );
    });

    it('should filter by username with case-insensitive contains', async () => {
      mockPrisma.loginLog.findMany.mockResolvedValueOnce([]);
      mockPrisma.loginLog.count.mockResolvedValueOnce(0);

      await service.findLoginLogs({ username: 'Admin' });

      expect(mockPrisma.loginLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            username: { contains: 'Admin', mode: 'insensitive' },
          }),
        })
      );
    });

    it('should filter by actionType', async () => {
      mockPrisma.loginLog.findMany.mockResolvedValueOnce([]);
      mockPrisma.loginLog.count.mockResolvedValueOnce(0);

      await service.findLoginLogs({ actionType: ['LOGOUT'] });

      expect(mockPrisma.loginLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ actionType: { in: ['LOGOUT'] } }),
        })
      );
    });

    it('should filter by status', async () => {
      mockPrisma.loginLog.findMany.mockResolvedValueOnce([]);
      mockPrisma.loginLog.count.mockResolvedValueOnce(0);

      await service.findLoginLogs({ status: ['FAILED'] });

      expect(mockPrisma.loginLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ status: { in: ['FAILED'] } }),
        })
      );
    });

    it('should filter by date range with startDate (gte) and endDate (lte)', async () => {
      mockPrisma.loginLog.findMany.mockResolvedValueOnce([]);
      mockPrisma.loginLog.count.mockResolvedValueOnce(0);

      await service.findLoginLogs({
        startDate: '2026-01-01T00:00:00Z',
        endDate: '2026-01-31T18:00:00Z',
      });

      const calledWhere = mockPrisma.loginLog.findMany.mock.calls[0]![0].where;
      expect(calledWhere.createdAt).toEqual({
        gte: new Date('2026-01-01T00:00:00Z'),
        lte: new Date('2026-01-31T18:00:00Z'),
      });
    });

    it('should append T23:59:59.999Z to endDate when no time component is provided', async () => {
      mockPrisma.loginLog.findMany.mockResolvedValueOnce([]);
      mockPrisma.loginLog.count.mockResolvedValueOnce(0);

      await service.findLoginLogs({ endDate: '2026-02-15' });

      const calledWhere = mockPrisma.loginLog.findMany.mock.calls[0]![0].where;
      expect(calledWhere.createdAt).toEqual({
        lte: new Date('2026-02-15T23:59:59.999Z'),
      });
    });
  });
});
