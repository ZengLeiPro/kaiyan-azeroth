import { queryFinanceImportBatchSchema } from '@ky-azeroth/shared/schemas';
import { createZodDto } from 'nestjs-zod';

export class QueryFinanceImportBatchDto extends createZodDto(queryFinanceImportBatchSchema) {}
