import { approvalActionSchema, withdrawApprovalSchema } from '@ky-azeroth/shared/schemas';
import { createZodDto } from 'nestjs-zod';

export class ApprovalActionDto extends createZodDto(approvalActionSchema) {}
export class WithdrawApprovalDto extends createZodDto(withdrawApprovalSchema) {}
