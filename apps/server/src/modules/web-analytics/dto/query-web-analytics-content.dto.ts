import { webAnalyticsContentQuerySchema } from '@ky-azeroth/shared/schemas';
import { createZodDto } from 'nestjs-zod';

export class QueryWebAnalyticsContentDto extends createZodDto(webAnalyticsContentQuerySchema) {}
