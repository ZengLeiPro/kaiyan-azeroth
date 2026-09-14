import { setEmployeeDepartmentsSchema } from '@ky-azeroth/shared/schemas';
import { createZodDto } from 'nestjs-zod';

export class SetEmployeeDepartmentsDto extends createZodDto(setEmployeeDepartmentsSchema) {}
