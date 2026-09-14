import { createEmployeeSchema } from '@ky-azeroth/shared/schemas';
import { createZodDto } from 'nestjs-zod';

export class CreateEmployeeDto extends createZodDto(createEmployeeSchema) {}
