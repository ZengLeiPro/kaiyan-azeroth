import { queryEffortRecordSchema } from '@ky-azeroth/shared/schemas';
import { createZodDto } from 'nestjs-zod';

export class QueryEffortRecordDto extends createZodDto(queryEffortRecordSchema) {}
