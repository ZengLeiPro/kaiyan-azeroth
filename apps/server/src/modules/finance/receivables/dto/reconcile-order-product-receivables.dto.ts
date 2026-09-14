import { reconcileOrderProductReceivablesSchema } from '@ky-azeroth/shared/schemas';
import { createZodDto } from 'nestjs-zod';

/**
 * 修复 OrderProduct.totalReceivedAmount 失同步行（绑定方案 v2.2 Phase 3）
 * 受保护管理端点端点 POST /finance/reconcile-order-product-receivables
 *
 * dryRun 默认 true（安全），false 才实际写库
 * orderProductIds 不传 = 全表（单批 ≤ 500）
 */
export class ReconcileOrderProductReceivablesDto extends createZodDto(
  reconcileOrderProductReceivablesSchema
) {}
