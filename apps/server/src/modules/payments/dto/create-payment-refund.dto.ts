import { createPaymentRefundSchema } from '@ky-azeroth/shared/schemas';
import { createZodDto } from 'nestjs-zod';

/**
 * 创建退款 DTO（direction='OUT' 专用）
 *
 * 与 CreatePaymentDto 的差异：
 * - refundType / relatedPaymentId 必填
 * - 后端会强制 direction='OUT'，无论前端是否传
 * - paymentAmount 必须 > 0
 */
export class CreatePaymentRefundDto extends createZodDto(createPaymentRefundSchema) {}
