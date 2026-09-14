import { webAnalyticsEventsQuerySchema } from '@ky-azeroth/shared/schemas';
import { createZodDto } from 'nestjs-zod';

export class QueryWebAnalyticsEventsDto extends createZodDto(webAnalyticsEventsQuerySchema) {}
