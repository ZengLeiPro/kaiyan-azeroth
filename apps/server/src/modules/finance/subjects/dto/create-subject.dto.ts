import { createFinanceSubjectSchema } from '@ky-azeroth/shared/schemas';
import { createZodDto } from 'nestjs-zod';

export class CreateFinanceSubjectDto extends createZodDto(createFinanceSubjectSchema) {}
