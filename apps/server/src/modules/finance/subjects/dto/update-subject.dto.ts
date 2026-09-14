import { updateFinanceSubjectSchema } from '@ky-azeroth/shared/schemas';
import { createZodDto } from 'nestjs-zod';

export class UpdateFinanceSubjectDto extends createZodDto(updateFinanceSubjectSchema) {}
