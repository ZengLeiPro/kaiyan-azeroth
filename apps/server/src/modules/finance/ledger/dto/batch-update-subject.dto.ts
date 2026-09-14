import { batchUpdateSubjectSchema } from '@ky-azeroth/shared/schemas';
import { createZodDto } from 'nestjs-zod';

/**
 * 批量改派生 ledger 科目（绑定方案 v2.1 Phase 4.5）
 * 受保护管理端点端点 PATCH /finance-ledger/batch-update-subject
 *
 * 用法：admin 在 finance-ledger 列表上多选 N 行（source='crm_payment' 且
 * subjectCode='non_pl.uncategorized' 的待归类派生 ledger），批量分配到正式科目。
 *
 * 上限 200 行，超出请分批处理（避免事务过长 + 审计日志爆炸）。
 */
export class BatchUpdateSubjectDto extends createZodDto(batchUpdateSubjectSchema) {}
