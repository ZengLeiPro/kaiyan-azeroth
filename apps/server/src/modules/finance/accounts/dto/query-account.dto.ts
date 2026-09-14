import { queryFinanceAccountSchema } from '@ky-azeroth/shared/schemas';
import { createZodDto } from 'nestjs-zod';

export class QueryFinanceAccountDto extends createZodDto(queryFinanceAccountSchema) {}
