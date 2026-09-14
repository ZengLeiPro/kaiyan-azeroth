import { createPaginatedResponseSchema } from '@ky-azeroth/shared/schemas';
import {
  approvalFlowResponseSchema,
  approvalModuleStatusListSchema,
} from '@ky-azeroth/shared/schemas/approval';
import { createZodDto } from 'nestjs-zod';

export class ApprovalFlowResponseDto extends createZodDto(approvalFlowResponseSchema) {}

export class ApprovalFlowListResponseDto extends createZodDto(
  createPaginatedResponseSchema(approvalFlowResponseSchema)
) {}

export class ApprovalModuleStatusListDto extends createZodDto(approvalModuleStatusListSchema) {}
