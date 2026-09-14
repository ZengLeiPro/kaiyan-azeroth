import { updateFinanceAccountSchema } from '@ky-azeroth/shared/schemas';
import { createZodDto } from 'nestjs-zod';

export class UpdateFinanceAccountDto extends createZodDto(updateFinanceAccountSchema) {}
