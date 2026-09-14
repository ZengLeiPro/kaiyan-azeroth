import { createPaginatedResponseSchema } from '@ky-azeroth/shared/schemas';
import { keepRecordResponseSchema } from '@ky-azeroth/shared/schemas/keep-record';
import { createZodDto } from 'nestjs-zod';

export class KeepRecordResponseDto extends createZodDto(keepRecordResponseSchema) {}

export class KeepRecordListResponseDto extends createZodDto(
  createPaginatedResponseSchema(keepRecordResponseSchema)
) {}
