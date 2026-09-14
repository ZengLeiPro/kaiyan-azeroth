import { createFinancePersonalLedgerSchema } from '@ky-azeroth/shared/schemas';
import { createZodDto } from 'nestjs-zod';

export class CreateFinancePersonalLedgerDto extends createZodDto(
  createFinancePersonalLedgerSchema
) {}
