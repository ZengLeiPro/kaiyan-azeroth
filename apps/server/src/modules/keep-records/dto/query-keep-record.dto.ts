import { queryKeepRecordSchema } from '@ky-azeroth/shared/schemas';
import { createZodDto } from 'nestjs-zod';

export class QueryKeepRecordDto extends createZodDto(queryKeepRecordSchema) {}
