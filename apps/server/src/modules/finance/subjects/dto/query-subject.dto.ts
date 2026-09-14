import { queryFinanceSubjectSchema } from '@ky-azeroth/shared/schemas';
import { createZodDto } from 'nestjs-zod';

export class QueryFinanceSubjectDto extends createZodDto(queryFinanceSubjectSchema) {}
