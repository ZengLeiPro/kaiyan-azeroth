import { addEmployeeToDepartmentSchema } from '@ky-azeroth/shared/schemas';
import { createZodDto } from 'nestjs-zod';

export class AddEmployeeToDepartmentDto extends createZodDto(addEmployeeToDepartmentSchema) {}
