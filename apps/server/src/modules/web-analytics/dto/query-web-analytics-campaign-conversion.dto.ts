import { webAnalyticsCampaignConversionQuerySchema } from '@ky-azeroth/shared/schemas';
import { createZodDto } from 'nestjs-zod';

export class QueryWebAnalyticsCampaignConversionDto extends createZodDto(
  webAnalyticsCampaignConversionQuerySchema
) {}
