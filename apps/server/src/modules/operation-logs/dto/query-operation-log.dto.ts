import { queryOperationLogSchema } from '@ky-azeroth/shared/schemas';
import { createZodDto } from 'nestjs-zod';

export class QueryOperationLogDto extends createZodDto(queryOperationLogSchema) {}
