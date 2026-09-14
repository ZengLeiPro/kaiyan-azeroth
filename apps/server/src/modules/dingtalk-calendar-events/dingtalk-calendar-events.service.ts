import type { CalendarEventResponseOutput } from '@ky-azeroth/shared/schemas/calendar-event';
import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import type { PaginatedResponse } from '../../common/interfaces/pagination.interface';
import { PrismaService } from '../../common/prisma/prisma.service';
import { calculatePagination, serializeEntity } from '../../common/utils/response-helpers';
import { QueryCalendarEventDto } from './dto/query-calendar-event.dto';

@Injectable()
export class DingtalkCalendarEventsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(
    query: QueryCalendarEventDto
  ): Promise<PaginatedResponse<CalendarEventResponseOutput>> {
    const { keyword, page = 1, pageSize = 20 } = query;
    const { skip } = calculatePagination(page, pageSize);

    const where: Prisma.DingtalkCalendarEventWhereInput = {
      ...(keyword && {
        title: { contains: keyword, mode: 'insensitive' as const },
      }),
    };

    const [total, items] = await Promise.all([
      this.prisma.dingtalkCalendarEvent.count({ where }),
      this.prisma.dingtalkCalendarEvent.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: { startTime: 'desc' },
      }),
    ]);

    return {
      items: items.map((item) =>
        serializeEntity<CalendarEventResponseOutput>(item as Record<string, unknown>)
      ),
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  async findOne(eventId: string): Promise<CalendarEventResponseOutput> {
    const event = await this.prisma.dingtalkCalendarEvent.findUnique({
      where: { eventId },
    });

    if (!event) {
      throw new NotFoundException('日程事件不存在');
    }

    return serializeEntity<CalendarEventResponseOutput>(event as Record<string, unknown>);
  }
}
