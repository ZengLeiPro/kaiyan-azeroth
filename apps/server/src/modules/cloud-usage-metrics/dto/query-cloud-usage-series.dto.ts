import { queryCloudUsageSeriesSchema } from '@ky-azeroth/shared/schemas';
import { createZodDto } from 'nestjs-zod';

// @no-pagination: 时序聚合返回固定时间窗内的点序列
export class QueryCloudUsageSeriesDto extends createZodDto(queryCloudUsageSeriesSchema) {}
