import { querySeoSearchRankingSchema } from '@ky-azeroth/shared/schemas';
import { createZodDto } from 'nestjs-zod';

export class QuerySeoSearchRankingDto extends createZodDto(querySeoSearchRankingSchema) {}
