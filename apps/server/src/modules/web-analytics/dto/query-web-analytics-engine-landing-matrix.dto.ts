import { webAnalyticsEngineLandingMatrixQuerySchema } from '@ky-azeroth/shared/schemas';
import { createZodDto } from 'nestjs-zod';

export class QueryWebAnalyticsEngineLandingMatrixDto extends createZodDto(
  webAnalyticsEngineLandingMatrixQuerySchema
) {}
