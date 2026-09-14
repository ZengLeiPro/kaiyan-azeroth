import { webAnalyticsAttributionQuerySchema } from '@ky-azeroth/shared/schemas';
import { createZodDto } from 'nestjs-zod';

export class QueryWebAnalyticsAttributionDto extends createZodDto(
  webAnalyticsAttributionQuerySchema
) {}
