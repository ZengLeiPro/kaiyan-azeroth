import { linkPaymentSchema } from '@ky-azeroth/shared/schemas';
import { createZodDto } from 'nestjs-zod';

/**
 * 手动绑定独立 ledger 到 Payment（绑定方案 v2.1）
 * 受保护管理端点端点 POST /finance-ledger/:id/link-payment
 * 主要供历史数据规整新会话的回填脚本调用
 */
export class LinkPaymentDto extends createZodDto(linkPaymentSchema) {}
