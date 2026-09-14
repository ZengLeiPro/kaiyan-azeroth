import { queryFinancePersonalLedgerSchema } from '@ky-azeroth/shared/schemas';
import { createZodDto } from 'nestjs-zod';

export class QueryFinancePersonalLedgerDto extends createZodDto(queryFinancePersonalLedgerSchema) {}
