import { updateDepartmentSchema } from '@ky-azeroth/shared/schemas';
import { createZodDto } from 'nestjs-zod';

export class UpdateDepartmentDto extends createZodDto(updateDepartmentSchema) {}
