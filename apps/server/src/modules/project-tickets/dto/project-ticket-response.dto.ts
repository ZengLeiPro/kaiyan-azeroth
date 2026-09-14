import {
  createPaginatedResponseSchema,
  projectTicketResponseSchema,
} from '@ky-azeroth/shared/schemas';
import { createZodDto } from 'nestjs-zod';

export class ProjectTicketResponseDto extends createZodDto(projectTicketResponseSchema) {}

export class ProjectTicketListResponseDto extends createZodDto(
  createPaginatedResponseSchema(projectTicketResponseSchema)
) {}
