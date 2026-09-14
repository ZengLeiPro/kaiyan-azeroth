import {
  createPaginatedResponseSchema,
  projectMemberSchema,
  projectResponseSchema,
} from '@ky-azeroth/shared/schemas';
import { createZodDto } from 'nestjs-zod';

export class ProjectResponseDto extends createZodDto(projectResponseSchema) {}

export class ProjectMemberResponseDto extends createZodDto(projectMemberSchema) {}

export class ProjectListResponseDto extends createZodDto(
  createPaginatedResponseSchema(projectResponseSchema)
) {}
