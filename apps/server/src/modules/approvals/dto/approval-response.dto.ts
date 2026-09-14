import { createPaginatedResponseSchema } from '@ky-azeroth/shared/schemas';
import {
  approvalInstanceResponseSchema,
  approvalTaskResponseSchema,
} from '@ky-azeroth/shared/schemas/approval';
import { createZodDto } from 'nestjs-zod';

export class ApprovalInstanceResponseDto extends createZodDto(approvalInstanceResponseSchema) {}

export class ApprovalInstanceListResponseDto extends createZodDto(
  createPaginatedResponseSchema(approvalInstanceResponseSchema)
) {}

export class ApprovalTaskListResponseDto extends createZodDto(
  createPaginatedResponseSchema(
    approvalTaskResponseSchema.extend({
      instance: approvalInstanceResponseSchema.optional(),
    })
  )
) {}
