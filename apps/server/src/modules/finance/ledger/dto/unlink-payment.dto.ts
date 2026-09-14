import { unlinkPaymentSchema } from '@ky-azeroth/shared/schemas';
import { createZodDto } from 'nestjs-zod';

/**
 * 解绑派生 ledger 与 Payment 的关联（绑定方案 v2.1）
 * 受保护管理端点端点 POST /finance-ledger/:id/unlink-payment
 */
export class UnlinkPaymentDto extends createZodDto(unlinkPaymentSchema) {}
