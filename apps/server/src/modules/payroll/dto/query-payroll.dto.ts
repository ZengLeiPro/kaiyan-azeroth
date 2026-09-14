import { queryPayrollSchema } from '@ky-azeroth/shared/schemas';
import { createZodDto } from 'nestjs-zod';

export class QueryPayrollDto extends createZodDto(queryPayrollSchema) {}
