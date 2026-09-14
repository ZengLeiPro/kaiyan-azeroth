import {
  createPaginatedResponseSchema,
  departmentEmployeeItemSchema,
  departmentForSelectionSchema,
  departmentResponseSchema,
} from '@ky-azeroth/shared/schemas';
import { createZodDto } from 'nestjs-zod';

export class DepartmentResponseDto extends createZodDto(departmentResponseSchema) {}

export class DepartmentForSelectionDto extends createZodDto(departmentForSelectionSchema) {}

export class DepartmentListResponseDto extends createZodDto(
  createPaginatedResponseSchema(departmentResponseSchema)
) {}

export class DepartmentEmployeeListResponseDto extends createZodDto(
  createPaginatedResponseSchema(departmentEmployeeItemSchema)
) {}
