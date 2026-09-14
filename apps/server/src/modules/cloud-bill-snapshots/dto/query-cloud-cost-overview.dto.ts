import { queryCloudCostOverviewSchema } from '@ky-azeroth/shared/schemas';
import { createZodDto } from 'nestjs-zod';

// @no-pagination: 汇总查询，返回聚合数据
export class QueryCloudCostOverviewDto extends createZodDto(queryCloudCostOverviewSchema) {}
