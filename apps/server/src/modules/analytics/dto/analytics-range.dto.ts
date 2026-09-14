import { analyticsRangeSchema } from '@ky-azeroth/shared/schemas';
import { createZodDto } from 'nestjs-zod';

export class AnalyticsRangeDto extends createZodDto(analyticsRangeSchema) {}
