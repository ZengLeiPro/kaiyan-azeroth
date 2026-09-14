import { financeImportCommitInputSchema } from '@ky-azeroth/shared/schemas';
import { createZodDto } from 'nestjs-zod';

export class FinanceImportCommitDto extends createZodDto(financeImportCommitInputSchema) {}
