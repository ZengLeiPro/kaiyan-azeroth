import { createPaginatedResponseSchema } from '@ky-azeroth/shared/schemas';
import { visitRecordResponseSchema } from '@ky-azeroth/shared/schemas/visit-record';
import { createZodDto } from 'nestjs-zod';

export class VisitRecordResponseDto extends createZodDto(visitRecordResponseSchema) {}

export class VisitRecordListResponseDto extends createZodDto(
  createPaginatedResponseSchema(visitRecordResponseSchema)
) {}
