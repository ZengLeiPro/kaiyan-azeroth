import { queryCloudUsageMetricSchema } from '@ky-azeroth/shared/schemas';
import { createZodDto } from 'nestjs-zod';

export class QueryCloudUsageMetricDto extends createZodDto(queryCloudUsageMetricSchema) {}
