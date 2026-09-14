import { webAnalyticsSearchKeywordsQuerySchema } from '@ky-azeroth/shared/schemas';
import { createZodDto } from 'nestjs-zod';

export class QueryWebAnalyticsSearchKeywordsDto extends createZodDto(
  webAnalyticsSearchKeywordsQuerySchema
) {}
