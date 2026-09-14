import type { NotificationResponseOutput } from '@ky-azeroth/shared/schemas';
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import type { PaginatedResponse } from '../../common/interfaces/pagination.interface';
import { PrismaService } from '../../common/prisma/prisma.service';
import { auditCreate } from '../../common/utils/audit-helper';
import { calculatePagination, serializeEntity } from '../../common/utils/response-helpers';

/**
 * push 6: notifications.userId 列已删除，统一以 employeeId 为目标。
 */
@Injectable()
export class NotificationsService {
  constructor(private prisma: PrismaService) {}

  /**
   * 创建通知
   */
  async create(data: {
    employeeId: string;
    type: string;
    title: string;
    content: string;
    link?: string;
  }) {
    return this.prisma.notification.create({
      data: {
        employeeId: data.employeeId,
        type: data.type,
        title: data.title,
        content: data.content,
        link: data.link,
        // 通知由系统创建（业务事件触发，无显式 currentUser）
        ...auditCreate(null),
      },
    });
  }

  /**
   * 获取员工通知列表
   */
  async findAll(params: {
    employeeId: string;
    page?: number;
    pageSize?: number;
    isRead?: boolean;
    type?: string[];
  }): Promise<PaginatedResponse<NotificationResponseOutput>> {
    const { employeeId, type, isRead, page = 1, pageSize = 10 } = params;
    const { skip, take } = calculatePagination(page, pageSize);

    const where: Prisma.NotificationWhereInput = { employeeId, deletedAt: null };

    if (type?.length) {
      where.type = { in: type };
    }

    if (isRead !== undefined) {
      where.isRead = isRead;
    }

    const [data, total] = await Promise.all([
      this.prisma.notification.findMany({
        where,
        skip,
        take,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.notification.count({ where }),
    ]);

    return {
      items: data.map((item) => serializeEntity<NotificationResponseOutput>(item)),
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  /**
   * 获取未读通知数量
   */
  async getUnreadCount(employeeId: string) {
    const count = await this.prisma.notification.count({
      where: {
        employeeId,
        isRead: false,
        deletedAt: null,
      },
    });

    return { count };
  }

  /**
   * 标记单条通知为已读
   */
  async markAsRead(id: string, employeeId: string) {
    return this.prisma.notification.updateMany({
      where: {
        id,
        employeeId, // 确保只能标记自己的通知
        deletedAt: null,
      },
      data: {
        isRead: true,
        readAt: new Date(),
      },
    });
  }

  /**
   * 标记全部通知为已读
   */
  async markAllAsRead(employeeId: string) {
    const result = await this.prisma.notification.updateMany({
      where: {
        employeeId,
        isRead: false,
        deletedAt: null,
      },
      data: {
        isRead: true,
        readAt: new Date(),
      },
    });

    return {
      message: '已标记全部为已读',
      count: result.count,
    };
  }

  /**
   * 删除通知
   */
  async remove(id: string, employeeId: string) {
    return this.prisma.notification.updateMany({
      where: {
        id,
        employeeId,
        deletedAt: null,
      },
      data: {
        deletedAt: new Date(),
      },
    });
  }

  /**
   * 批量发送通知（给多个员工）
   */
  async sendToEmployees(data: {
    employeeIds: string[];
    type: string;
    title: string;
    content: string;
    link?: string;
  }) {
    const auditFields = auditCreate(null);
    const notifications = data.employeeIds.map((employeeId) => ({
      employeeId,
      type: data.type,
      title: data.title,
      content: data.content,
      link: data.link,
      ...auditFields,
    }));

    return this.prisma.notification.createMany({
      data: notifications,
    });
  }
}
