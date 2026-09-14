import { queryOpportunitySchema } from '@ky-azeroth/shared/schemas';
import { createZodDto } from 'nestjs-zod';

export class QueryOpportunityDto extends createZodDto(queryOpportunitySchema) {}
