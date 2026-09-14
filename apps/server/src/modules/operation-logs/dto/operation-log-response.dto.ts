import { createPaginatedResponseSchema } from '@ky-azeroth/shared/schemas';
import {
  loginLogResponseSchema,
  operationLogResponseSchema,
} from '@ky-azeroth/shared/schemas/system';
import { createZodDto } from 'nestjs-zod';

export class OperationLogResponseDto extends createZodDto(operationLogResponseSchema) {}

export class OperationLogListResponseDto extends createZodDto(
  createPaginatedResponseSchema(operationLogResponseSchema)
) {}

export class LoginLogResponseDto extends createZodDto(loginLogResponseSchema) {}

export class LoginLogListResponseDto extends createZodDto(
  createPaginatedResponseSchema(loginLogResponseSchema)
) {}
