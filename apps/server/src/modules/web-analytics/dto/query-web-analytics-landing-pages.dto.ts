import { webAnalyticsLandingPagesQuerySchema } from '@ky-azeroth/shared/schemas';
import { createZodDto } from 'nestjs-zod';

export class QueryWebAnalyticsLandingPagesDto extends createZodDto(
  webAnalyticsLandingPagesQuerySchema
) {}
