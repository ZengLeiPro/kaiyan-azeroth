import { queryFinanceLedgerSchema } from '@ky-azeroth/shared/schemas';
import { createZodDto } from 'nestjs-zod';

export class QueryFinanceLedgerDto extends createZodDto(queryFinanceLedgerSchema) {}
