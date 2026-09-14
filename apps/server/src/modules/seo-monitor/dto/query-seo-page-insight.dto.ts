import { querySeoPageInsightSchema } from '@ky-azeroth/shared/schemas';
import { createZodDto } from 'nestjs-zod';

export class QuerySeoPageInsightDto extends createZodDto(querySeoPageInsightSchema) {}
