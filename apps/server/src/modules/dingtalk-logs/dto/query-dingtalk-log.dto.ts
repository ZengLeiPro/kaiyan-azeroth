import { queryDingtalkLogSchema } from '@ky-azeroth/shared/schemas';
import { createZodDto } from 'nestjs-zod';

export class QueryDingtalkLogDto extends createZodDto(queryDingtalkLogSchema) {}
