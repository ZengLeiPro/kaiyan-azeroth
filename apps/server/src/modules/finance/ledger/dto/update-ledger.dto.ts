import { updateFinanceLedgerSchema } from '@ky-azeroth/shared/schemas';
import { createZodDto } from 'nestjs-zod';

export class UpdateFinanceLedgerDto extends createZodDto(updateFinanceLedgerSchema) {}
