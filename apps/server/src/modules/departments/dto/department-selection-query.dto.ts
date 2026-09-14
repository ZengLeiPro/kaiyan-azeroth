import { departmentSelectionQuerySchema } from '@ky-azeroth/shared/schemas';
import { createZodDto } from 'nestjs-zod';

export class DepartmentSelectionQueryDto extends createZodDto(departmentSelectionQuerySchema) {}
