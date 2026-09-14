import { voidApprovalRequestSchema } from '@ky-azeroth/shared/schemas/approval';
import { createZodDto } from 'nestjs-zod';

/** 已审批业务单据作废申请 DTO。 */
export class VoidApprovalRequestDto extends createZodDto(voidApprovalRequestSchema) {}
