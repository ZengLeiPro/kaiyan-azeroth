import { createFinanceLedgerSchema } from '@ky-azeroth/shared/schemas';
import { createZodDto } from 'nestjs-zod';

export class CreateFinanceLedgerDto extends createZodDto(createFinanceLedgerSchema) {}
