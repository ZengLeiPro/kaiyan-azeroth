import { createApprovalFlowSchema } from '@ky-azeroth/shared/schemas';
import { createZodDto } from 'nestjs-zod';

export class CreateApprovalFlowDto extends createZodDto(createApprovalFlowSchema) {}
