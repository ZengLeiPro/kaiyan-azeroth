import { queryHolidaySchema } from '@ky-azeroth/shared/schemas';
import { createZodDto } from 'nestjs-zod';

export class QueryHolidayDto extends createZodDto(queryHolidaySchema) {}
