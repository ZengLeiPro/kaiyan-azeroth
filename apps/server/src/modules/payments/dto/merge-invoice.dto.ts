import { mergeInvoiceSchema } from '@ky-azeroth/shared/schemas/payment';
import { createZodDto } from 'nestjs-zod';

/**
 * 合并开票 DTO（v1）：选 N 条回款合并开一张发票。
 * 严校验同 customerId + 同 saleOrderId + 全 IN + 已审批 + 未合并过。
 */
export class MergeInvoiceDto extends createZodDto(mergeInvoiceSchema) {}
