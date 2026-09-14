import { webAnalyticsLeadRadarQuerySchema } from '@ky-azeroth/shared/schemas';
import { createZodDto } from 'nestjs-zod';

export class QueryWebAnalyticsLeadRadarDto extends createZodDto(webAnalyticsLeadRadarQuerySchema) {}
