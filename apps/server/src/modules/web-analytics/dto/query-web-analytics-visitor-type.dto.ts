import { webAnalyticsVisitorTypeQuerySchema } from '@ky-azeroth/shared/schemas';
import { createZodDto } from 'nestjs-zod';

export class QueryWebAnalyticsVisitorTypeDto extends createZodDto(
  webAnalyticsVisitorTypeQuerySchema
) {}
