import { createPayrollSchema } from '@ky-azeroth/shared/schemas';
import { createZodDto } from 'nestjs-zod';

export class CreatePayrollDto extends createZodDto(createPayrollSchema) {}
