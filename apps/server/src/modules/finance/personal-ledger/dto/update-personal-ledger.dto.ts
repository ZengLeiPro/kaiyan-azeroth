import { updateFinancePersonalLedgerSchema } from '@ky-azeroth/shared/schemas';
import { createZodDto } from 'nestjs-zod';

export class UpdateFinancePersonalLedgerDto extends createZodDto(
  updateFinancePersonalLedgerSchema
) {}
