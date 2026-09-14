import { queryCrmWorkDailySchema } from '@ky-azeroth/shared/schemas';
import { createZodDto } from 'nestjs-zod';

export class QueryCrmWorkDailyDto extends createZodDto(queryCrmWorkDailySchema) {}
