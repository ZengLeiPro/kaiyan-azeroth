import { webAnalyticsBreakdownQuerySchema } from '@ky-azeroth/shared/schemas';
import { createZodDto } from 'nestjs-zod';

export class QueryWebAnalyticsBreakdownDto extends createZodDto(webAnalyticsBreakdownQuerySchema) {}
