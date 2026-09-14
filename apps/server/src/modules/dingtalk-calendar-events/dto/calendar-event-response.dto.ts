import { createPaginatedResponseSchema } from '@ky-azeroth/shared/schemas';
import { calendarEventResponseSchema } from '@ky-azeroth/shared/schemas/calendar-event';
import { createZodDto } from 'nestjs-zod';

export class CalendarEventResponseDto extends createZodDto(calendarEventResponseSchema) {}

export class CalendarEventListResponseDto extends createZodDto(
  createPaginatedResponseSchema(calendarEventResponseSchema)
) {}
