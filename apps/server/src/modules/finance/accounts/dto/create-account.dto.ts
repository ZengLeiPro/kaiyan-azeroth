import { createFinanceAccountSchema } from '@ky-azeroth/shared/schemas';
import { createZodDto } from 'nestjs-zod';

export class CreateFinanceAccountDto extends createZodDto(createFinanceAccountSchema) {}
