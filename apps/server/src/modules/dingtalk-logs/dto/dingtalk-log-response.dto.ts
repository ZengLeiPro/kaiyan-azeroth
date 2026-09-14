import { createPaginatedResponseSchema } from '@ky-azeroth/shared/schemas';
import { dingtalkLogResponseSchema } from '@ky-azeroth/shared/schemas/dingtalk-log';
import { createZodDto } from 'nestjs-zod';

export class DingtalkLogResponseDto extends createZodDto(dingtalkLogResponseSchema) {}

export class DingtalkLogListResponseDto extends createZodDto(
  createPaginatedResponseSchema(dingtalkLogResponseSchema)
) {}
