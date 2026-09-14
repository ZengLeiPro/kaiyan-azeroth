import { batchApproveSchema } from '@ky-azeroth/shared/schemas/approval';
import { createZodDto } from 'nestjs-zod';

/**
 * 业务列表批量审批 DTO（订单/回款/开票共用）
 * 前端按 ApprovalInstance.id 入参；后端循环调 ApprovalsService.doApproval。
 */
export class BatchApproveDto extends createZodDto(batchApproveSchema) {}
