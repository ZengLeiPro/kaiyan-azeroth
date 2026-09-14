import { createDepartmentSchema } from '@ky-azeroth/shared/schemas';
import { createZodDto } from 'nestjs-zod';

export class CreateDepartmentDto extends createZodDto(createDepartmentSchema) {}
