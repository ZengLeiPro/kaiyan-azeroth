import { effortRecordResponseSchema } from '@ky-azeroth/shared/schemas';
import { createPaginatedResponseSchema } from '@ky-azeroth/shared/schemas';
import { createZodDto } from 'nestjs-zod';

export class EffortRecordResponseDto extends createZodDto(effortRecordResponseSchema) {}

export class EffortRecordListResponseDto extends createZodDto(
  createPaginatedResponseSchema(effortRecordResponseSchema)
) {}
