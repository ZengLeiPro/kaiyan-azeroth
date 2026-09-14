import { updateApprovalFlowSchema } from '@ky-azeroth/shared/schemas';
import { createZodDto } from 'nestjs-zod';

export class UpdateApprovalFlowDto extends createZodDto(updateApprovalFlowSchema) {}
