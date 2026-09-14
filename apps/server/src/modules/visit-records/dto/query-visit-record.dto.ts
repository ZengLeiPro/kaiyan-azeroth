import { queryVisitRecordSchema } from '@ky-azeroth/shared/schemas';
import { createZodDto } from 'nestjs-zod';

export class QueryVisitRecordDto extends createZodDto(queryVisitRecordSchema) {}
