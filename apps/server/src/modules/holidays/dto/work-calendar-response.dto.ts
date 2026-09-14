import { workCalendarResponseSchema } from '@ky-azeroth/shared/schemas';
import { createZodDto } from 'nestjs-zod';

/**
 * 工作日历响应 DTO
 */
export class WorkCalendarResponseDto extends createZodDto(workCalendarResponseSchema) {}
