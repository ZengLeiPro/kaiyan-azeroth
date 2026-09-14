import { projectTicketStatsResponseSchema } from '@ky-azeroth/shared/schemas';
import { createZodDto } from 'nestjs-zod';

export class ProjectTicketStatsResponseDto extends createZodDto(projectTicketStatsResponseSchema) {}
