import { updatePayrollSchema } from '@ky-azeroth/shared/schemas';
import { createZodDto } from 'nestjs-zod';

export class UpdatePayrollDto extends createZodDto(updatePayrollSchema) {}
