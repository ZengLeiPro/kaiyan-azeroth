import { queryApprovalFlowSchema } from '@ky-azeroth/shared/schemas';
import { createZodDto } from 'nestjs-zod';

export class QueryApprovalFlowDto extends createZodDto(queryApprovalFlowSchema) {}
