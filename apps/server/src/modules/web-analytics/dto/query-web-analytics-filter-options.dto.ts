import { webAnalyticsFilterOptionsQuerySchema } from '@ky-azeroth/shared/schemas';
import { createZodDto } from 'nestjs-zod';

export class QueryWebAnalyticsFilterOptionsDto extends createZodDto(
  webAnalyticsFilterOptionsQuerySchema
) {}
