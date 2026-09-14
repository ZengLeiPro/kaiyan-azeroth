import { queryCalendarEventSchema } from '@ky-azeroth/shared/schemas';
import { createZodDto } from 'nestjs-zod';

export class QueryCalendarEventDto extends createZodDto(queryCalendarEventSchema) {}
