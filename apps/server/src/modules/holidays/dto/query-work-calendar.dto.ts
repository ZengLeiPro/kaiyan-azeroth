import { queryWorkCalendarSchema } from '@ky-azeroth/shared/schemas';
import { createZodDto } from 'nestjs-zod';

/**
 * 工作日历查询 DTO（GET /holidays/calendar）
 */
export class QueryWorkCalendarDto extends createZodDto(queryWorkCalendarSchema) {}
