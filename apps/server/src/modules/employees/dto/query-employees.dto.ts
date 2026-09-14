import { queryEmployeeSchema } from '@ky-azeroth/shared/schemas';
import { createZodDto } from 'nestjs-zod';

export class QueryEmployeesDto extends createZodDto(queryEmployeeSchema) {}
