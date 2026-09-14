import { userResponseSchema } from '@ky-azeroth/shared/schemas';
import { createPaginatedResponseSchema } from '@ky-azeroth/shared/schemas';
import { createZodDto } from 'nestjs-zod';

export class UserResponseDto extends createZodDto(userResponseSchema) {}

export class UserListResponseDto extends createZodDto(
  createPaginatedResponseSchema(userResponseSchema)
) {}
