import { webAnalyticsSummaryQuerySchema } from '@ky-azeroth/shared/schemas';
import { createZodDto } from 'nestjs-zod';

export class QueryWebAnalyticsSummaryDto extends createZodDto(webAnalyticsSummaryQuerySchema) {}
