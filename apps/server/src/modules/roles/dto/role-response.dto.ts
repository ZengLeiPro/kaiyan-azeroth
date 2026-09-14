import { roleResponseSchema } from '@ky-azeroth/shared/schemas';
import { createPaginatedResponseSchema } from '@ky-azeroth/shared/schemas';
import { createZodDto } from 'nestjs-zod';

export class RoleResponseDto extends createZodDto(roleResponseSchema) {}

export class RoleListResponseDto extends createZodDto(
  createPaginatedResponseSchema(roleResponseSchema)
) {}
