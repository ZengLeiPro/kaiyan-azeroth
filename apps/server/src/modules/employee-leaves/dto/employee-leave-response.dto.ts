import { createPaginatedResponseSchema } from '@ky-azeroth/shared/schemas';
import { employeeLeaveResponseSchema } from '@ky-azeroth/shared/schemas/employee-leave';
import { createZodDto } from 'nestjs-zod';

export class EmployeeLeaveResponseDto extends createZodDto(employeeLeaveResponseSchema) {}

export class EmployeeLeaveListResponseDto extends createZodDto(
  createPaginatedResponseSchema(employeeLeaveResponseSchema)
) {}
