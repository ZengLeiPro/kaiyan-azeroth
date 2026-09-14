import { queryDepartmentEmployeesSchema } from '@ky-azeroth/shared/schemas';
import { createZodDto } from 'nestjs-zod';

export class QueryDepartmentEmployeesDto extends createZodDto(queryDepartmentEmployeesSchema) {}
