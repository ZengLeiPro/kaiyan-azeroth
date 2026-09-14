import { createPaginatedResponseSchema } from '@ky-azeroth/shared/schemas';
import { opportunityResponseSchema } from '@ky-azeroth/shared/schemas/opportunity';
import { createZodDto } from 'nestjs-zod';

export class OpportunityResponseDto extends createZodDto(opportunityResponseSchema) {}

export class OpportunityListResponseDto extends createZodDto(
  createPaginatedResponseSchema(opportunityResponseSchema)
) {}
