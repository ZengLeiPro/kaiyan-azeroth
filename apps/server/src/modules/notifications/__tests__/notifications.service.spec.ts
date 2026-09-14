import { vi } from 'vitest';

import {
  asPrismaService,
  createMockPrismaService,
  type MockPrismaService,
} from '../../../test/prisma-mock.factory';
import { NotificationsService } from '../notifications.service';

describe('NotificationsService', () => {
  let service: NotificationsService;
  let mockPrisma: MockPrismaService;

  beforeEach(() => {
    mockPrisma = createMockPrismaService();
    service = new NotificationsService(asPrismaService(mockPrisma));
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ─── create ───────────────────────────────────────────────────────────

  describe('create', () => {
    it('应创建通知并返回结果', async () => {
      const input = {
        employeeId: 'emp-1',
        type: 'SYSTEM',
        title: '系统通知',
        content: '这是一条系统通知',
        link: '/dashboard',
      };
      const created = {
        id: 'notif-1',
        ...input,
        isRead: false,
        readAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
      };
      mockPrisma.notification.create.mockResolvedValue(created);

      const result = await service.create(input);

      expect(result).toEqual(created);
      expect(mockPrisma.notification.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          type: 'SYSTEM',
          title: '系统通知',
          content: '这是一条系统通知',
          link: '/dashboard',
        }),
      });
    });

    it('应支持不传 link 的场景', async () => {
      const input = {
        employeeId: 'emp-1',
        type: 'TASK',
        title: '任务通知',
        content: '你有一个新任务',
      };
      const created = {
        id: 'notif-2',
        ...input,
        link: undefined,
        isRead: false,
        readAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
      };
      mockPrisma.notification.create.mockResolvedValue(created);

      const result = await service.create(input);

      expect(result).toEqual(created);
      expect(mockPrisma.notification.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          type: 'TASK',
          title: '任务通知',
          content: '你有一个新任务',
          link: undefined,
        }),
      });
    });
  });

  // ─── findAll ──────────────────────────────────────────────────────────

  describe('findAll', () => {
    it('应返回指定用户的分页通知列表', async () => {
      const notifications = [
        {
          id: 'n-1',
          employeeId: 'emp-1',
          type: 'SYSTEM',
          title: '通知1',
          content: '内容1',
          isRead: false,
          readAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          deletedAt: null,
        },
        {
          id: 'n-2',
          employeeId: 'emp-1',
          type: 'SYSTEM',
          title: '通知2',
          content: '内容2',
          isRead: true,
          readAt: new Date(),
          createdAt: new Date(),
          updatedAt: new Date(),
          deletedAt: null,
        },
      ];
      mockPrisma.notification.findMany.mockResolvedValue(notifications);
      mockPrisma.notification.count.mockResolvedValue(2);

      const result = await service.findAll({ employeeId: 'emp-1', page: 1, pageSize: 10 });

      expect(result.items).toHaveLength(2);
      expect(result.total).toBe(2);
      expect(result.page).toBe(1);
      expect(result.pageSize).toBe(10);
      expect(result.totalPages).toBe(1);
      expect(mockPrisma.notification.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { employeeId: 'emp-1', deletedAt: null },
          skip: 0,
          take: 10,
          orderBy: { createdAt: 'desc' },
        })
      );
      expect(mockPrisma.notification.count).toHaveBeenCalledWith({
        where: { employeeId: 'emp-1', deletedAt: null },
      });
    });

    it('应支持 isRead 筛选', async () => {
      mockPrisma.notification.findMany.mockResolvedValue([]);
      mockPrisma.notification.count.mockResolvedValue(0);

      await service.findAll({ employeeId: 'emp-1', isRead: false });

      expect(mockPrisma.notification.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { employeeId: 'emp-1', deletedAt: null, isRead: false },
        })
      );
    });

    it('应支持 type 筛选', async () => {
      mockPrisma.notification.findMany.mockResolvedValue([]);
      mockPrisma.notification.count.mockResolvedValue(0);

      await service.findAll({ employeeId: 'emp-1', type: ['TASK'] });

      expect(mockPrisma.notification.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { employeeId: 'emp-1', deletedAt: null, type: { in: ['TASK'] } },
        })
      );
    });

    it('应使用默认分页参数 page=1, pageSize=10', async () => {
      mockPrisma.notification.findMany.mockResolvedValue([]);
      mockPrisma.notification.count.mockResolvedValue(0);

      await service.findAll({ employeeId: 'emp-1' });

      expect(mockPrisma.notification.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          skip: 0,
          take: 10,
        })
      );
    });
  });

  // ─── getUnreadCount ───────────────────────────────────────────────────

  describe('getUnreadCount', () => {
    it('应返回未读通知数量', async () => {
      mockPrisma.notification.count.mockResolvedValue(5);

      const result = await service.getUnreadCount('emp-1');

      expect(result).toEqual({ count: 5 });
      expect(mockPrisma.notification.count).toHaveBeenCalledWith({
        where: {
          employeeId: 'emp-1',
          isRead: false,
          deletedAt: null,
        },
      });
    });

    it('应在没有未读通知时返回 0', async () => {
      mockPrisma.notification.count.mockResolvedValue(0);

      const result = await service.getUnreadCount('emp-1');

      expect(result).toEqual({ count: 0 });
    });
  });

  // ─── markAsRead ───────────────────────────────────────────────────────

  describe('markAsRead', () => {
    it('应标记指定通知为已读（userId 隔离）', async () => {
      mockPrisma.notification.updateMany.mockResolvedValue({ count: 1 });

      const result = await service.markAsRead('notif-1', 'emp-1');

      expect(result).toEqual({ count: 1 });
      expect(mockPrisma.notification.updateMany).toHaveBeenCalledWith({
        where: {
          id: 'notif-1',
          employeeId: 'emp-1',
          deletedAt: null,
        },
        data: {
          isRead: true,
          readAt: expect.any(Date),
        },
      });
    });
  });

  // ─── markAllAsRead ────────────────────────────────────────────────────

  describe('markAllAsRead', () => {
    it('应标记用户全部未读通知为已读并返回 message 和 count', async () => {
      mockPrisma.notification.updateMany.mockResolvedValue({ count: 3 });

      const result = await service.markAllAsRead('emp-1');

      expect(result).toEqual({ message: '已标记全部为已读', count: 3 });
      expect(mockPrisma.notification.updateMany).toHaveBeenCalledWith({
        where: {
          employeeId: 'emp-1',
          isRead: false,
          deletedAt: null,
        },
        data: {
          isRead: true,
          readAt: expect.any(Date),
        },
      });
    });

    it('应在没有未读通知时返回 count 为 0', async () => {
      mockPrisma.notification.updateMany.mockResolvedValue({ count: 0 });

      const result = await service.markAllAsRead('emp-1');

      expect(result).toEqual({ message: '已标记全部为已读', count: 0 });
    });
  });

  // ─── remove ───────────────────────────────────────────────────────────

  describe('remove', () => {
    it('应软删除指定通知（userId 隔离）', async () => {
      mockPrisma.notification.updateMany.mockResolvedValue({ count: 1 });

      const result = await service.remove('notif-1', 'emp-1');

      expect(result).toEqual({ count: 1 });
      expect(mockPrisma.notification.updateMany).toHaveBeenCalledWith({
        where: {
          id: 'notif-1',
          employeeId: 'emp-1',
          deletedAt: null,
        },
        data: {
          deletedAt: expect.any(Date),
        },
      });
    });
  });

  // ─── sendToEmployees ──────────────────────────────────────────────────────

  describe('sendToEmployees', () => {
    it('应批量创建通知给多个员工', async () => {
      mockPrisma.notification.createMany.mockResolvedValue({ count: 3 });

      const result = await service.sendToEmployees({
        employeeIds: ['emp-1', 'emp-2', 'emp-3'],
        type: 'ANNOUNCEMENT',
        title: '公告通知',
        content: '全员公告内容',
        link: '/announcements/1',
      });

      expect(result).toEqual({ count: 3 });
      expect(mockPrisma.notification.createMany).toHaveBeenCalledWith({
        data: [
          expect.objectContaining({
            employeeId: 'emp-1',
            type: 'ANNOUNCEMENT',
          }),
          expect.objectContaining({
            employeeId: 'emp-2',
            type: 'ANNOUNCEMENT',
          }),
          expect.objectContaining({
            employeeId: 'emp-3',
            type: 'ANNOUNCEMENT',
          }),
        ],
      });
    });
  });
});
