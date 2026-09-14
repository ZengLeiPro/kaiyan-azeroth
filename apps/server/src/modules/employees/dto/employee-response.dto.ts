import { createPaginatedResponseSchema } from '@ky-azeroth/shared/schemas';
import { employeeResponseSchema } from '@ky-azeroth/shared/schemas/employee';
import { createZodDto } from 'nestjs-zod';

export class EmployeeResponseDto extends createZodDto(employeeResponseSchema) {}

export class EmployeeListResponseDto extends createZodDto(
  createPaginatedResponseSchema(employeeResponseSchema)
) {}
