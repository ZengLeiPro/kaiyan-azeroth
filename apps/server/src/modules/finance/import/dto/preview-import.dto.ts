import { financeImportPreviewInputSchema } from '@ky-azeroth/shared/schemas';
import { createZodDto } from 'nestjs-zod';

export class FinanceImportPreviewDto extends createZodDto(financeImportPreviewInputSchema) {}
