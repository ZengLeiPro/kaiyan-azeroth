import { querySeoSyncRunSchema } from '@ky-azeroth/shared/schemas';
import { createZodDto } from 'nestjs-zod';

export class QuerySeoSyncRunDto extends createZodDto(querySeoSyncRunSchema) {}
