import { queryCloudPackageProjectionSchema } from '@ky-azeroth/shared/schemas';
import { createZodDto } from 'nestjs-zod';

// @no-pagination: 资源包列表为有限集合，一次性返回
export class QueryCloudPackageProjectionDto extends createZodDto(
  queryCloudPackageProjectionSchema
) {}
