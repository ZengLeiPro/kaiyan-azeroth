import { createOpportunitySchema } from '@ky-azeroth/shared/schemas';
import { createZodDto } from 'nestjs-zod';

export class CreateOpportunityDto extends createZodDto(createOpportunitySchema) {}
