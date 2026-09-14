import { updateOpportunitySchema } from '@ky-azeroth/shared/schemas';
import { createZodDto } from 'nestjs-zod';

export class UpdateOpportunityDto extends createZodDto(updateOpportunitySchema) {}
