import { updateEmployeeSchema } from '@ky-azeroth/shared/schemas';
import { createZodDto } from 'nestjs-zod';

export class UpdateEmployeeDto extends createZodDto(updateEmployeeSchema) {}
