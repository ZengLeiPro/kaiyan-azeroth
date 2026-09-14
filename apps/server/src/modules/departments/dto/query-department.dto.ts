import { queryDepartmentSchema } from '@ky-azeroth/shared/schemas';
import { createZodDto } from 'nestjs-zod';

export class QueryDepartmentDto extends createZodDto(queryDepartmentSchema) {}
