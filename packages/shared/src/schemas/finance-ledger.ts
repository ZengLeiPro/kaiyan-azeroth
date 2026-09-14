import { z } from 'zod';

import { withColumn } from './column-meta';
import { COL_AMOUNT, COL_DATE, COL_STATUS } from './column-widths';
import {
  dateString,
  paginationSchema,
  stringOrStringArray,
  stringOrStringArrayOfUuid,
} from './common';

/**
 * 财务流水（公司账主表）schema
 *
 * 公司现金流总账。私账（『个人』科目）走 finance-personal-ledger，物理隔离。
 * 一行 = 一笔交易：日期 + 账户 + 科目 + 金额（正收负支） + 备注
 *
 * runningBalance 不存储——列表查询时由后端 SQL `SUM() OVER (PARTITION BY accountId ORDER BY txDate, id)` 派生注入。
 */

export const FINANCE_LEDGER_DIRECTION_VALUES = ['in', 'out'] as const;
export const FINANCE_LEDGER_SOURCE_VALUES = ['dingtalk_import', 'manual'] as const;

export const createFinanceLedgerSchema = z.object({
  txDate: dateString,
  accountId: z.string().uuid('账户ID格式不正确'),
  subjectId: z.string().uuid('科目ID格式不正确'),
  /** @precision Decimal */
  amount: z.coerce
    .number({ required_error: '金额不能为空' })
    .refine((v) => v !== 0, { message: '金额不能为 0' }),
  /**
   * 'in' / 'out'，可选——后端根据 amount 符号自动派生：
   *   amount > 0 → 'in'
   *   amount < 0 → 'out'
   * 兼容旧客户端仍接收该字段，但后端永远以 amount 符号为唯一事实源。
   */
  direction: z.enum(FINANCE_LEDGER_DIRECTION_VALUES).optional(),
  remark: z.string().max(500).optional().nullable(),
  saleOrderId: z.string().uuid().optional().nullable(),
  payrollRecordId: z.string().uuid().optional().nullable(),
});

export const updateFinanceLedgerSchema = createFinanceLedgerSchema.partial().extend({
  version: z.number().int().optional(),
});

export const queryFinanceLedgerSchema = paginationSchema.extend({
  /** YYYY-MM-DD */
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  year: z.coerce.number().int().optional(),
  month: z.coerce.number().int().min(1).max(12).optional(),
  accountId: stringOrStringArrayOfUuid,
  subjectId: stringOrStringArrayOfUuid,
  category: stringOrStringArray,
  direction: z.enum(FINANCE_LEDGER_DIRECTION_VALUES).optional(),
  source: stringOrStringArray,
  importBatchId: z.string().uuid().optional(),
  keyword: z.string().max(100).optional(),
});

export const financeLedgerResponseSchema = z.object({
  id: z.string(),
  txDate: withColumn(z.string(), {
    label: '日期',
    width: COL_DATE,
    type: 'date',
    sortable: true,
    order: 10,
  }),
  accountId: z.string(),
  accountName: withColumn(z.string().optional().nullable(), {
    label: '账户',
    width: COL_STATUS,
    type: 'text',
    order: 20,
  }),
  subjectId: z.string(),
  subjectName: withColumn(z.string().optional().nullable(), {
    label: '科目',
    width: COL_STATUS,
    type: 'text',
    order: 30,
  }),
  subjectCategory: withColumn(z.string().optional().nullable(), {
    label: '大类',
    width: COL_STATUS,
    type: 'custom',
    hidden: true,
    order: 35,
  }),
  amount: withColumn(z.number(), {
    label: '金额',
    width: COL_AMOUNT,
    type: 'decimal',
    sortable: true,
    order: 40,
  }),
  direction: withColumn(z.string(), {
    label: '方向',
    width: COL_STATUS,
    type: 'custom',
    order: 50,
  }),
  /** 后端用 SQL 窗口函数派生：SUM(amount) OVER (PARTITION BY accountId ORDER BY txDate, id) */
  runningBalance: withColumn(z.number().optional().nullable(), {
    label: '账户余额',
    width: COL_AMOUNT,
    type: 'decimal',
    order: 60,
  }),
  remark: withColumn(z.string().optional().nullable(), {
    label: '备注',
    width: COL_STATUS,
    type: 'text',
    order: 70,
  }),
  source: withColumn(z.string(), {
    label: '来源',
    width: COL_STATUS,
    type: 'custom',
    hidden: true,
    order: 80,
  }),
  dingtalkSheetName: z.string().optional().nullable(),
  dingtalkRowIndex: z.number().optional().nullable(),
  dingtalkRowHash: z.string().optional().nullable(),
  saleOrderId: z.string().optional().nullable(),
  payrollRecordId: z.string().optional().nullable(),
  importBatchId: z.string().optional().nullable(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
  deletedAt: z.string().optional().nullable(),
  version: z.number().optional(),
});

export type CreateFinanceLedgerInput = z.infer<typeof createFinanceLedgerSchema>;
export type UpdateFinanceLedgerInput = z.infer<typeof updateFinanceLedgerSchema>;
export type QueryFinanceLedgerInput = z.infer<typeof queryFinanceLedgerSchema>;
export type FinanceLedgerResponseOutput = z.infer<typeof financeLedgerResponseSchema>;

// ============================================================
// CRM 回款 ↔ 财务流水绑定方案 v2.1 / 受保护管理端点端点 schema
// ============================================================

/**
 * 解绑派生 ledger 与 Payment 的关联（POST /finance-ledger/:id/unlink-payment）
 */
export const unlinkPaymentSchema = z
  .object({
    reason: z.string().min(4, '解绑必须填写理由（至少 4 字）').max(500),
  })
  .strict();

/**
 * 手动绑定独立 ledger 到 Payment（POST /finance-ledger/:id/link-payment）
 * 主要供历史数据规整新会话的回填脚本调用
 */
export const linkPaymentSchema = z
  .object({
    paymentId: z.string().uuid(),
    reason: z.string().min(4, '绑定必须填写理由（至少 4 字）').max(500),
  })
  .strict();

/**
 * 批量改派生 ledger 科目（PATCH /finance-ledger/batch-update-subject）
 * 典型用法：admin 在 finance-ledger 列表多选「待归类」派生 ledger，批量分到正式科目
 * 上限 200 行
 */
export const batchUpdateSubjectSchema = z
  .object({
    ledgerIds: z.array(z.string().uuid()).min(1).max(200),
    subjectId: z.string().uuid(),
  })
  .strict();

/**
 * OrderProduct.totalReceivedAmount 反向缓存修复（POST /finance/reconcile-order-product-receivables）
 * 绑定方案 v2.2 Phase 3 管理员 端点
 *
 * dryRun 默认 true（安全），false 才实际修复失同步行
 * orderProductIds 不传 = 全表
 */
export const reconcileOrderProductReceivablesSchema = z
  .object({
    orderProductIds: z.array(z.string().uuid()).max(500).optional(),
    dryRun: z.boolean().default(true),
  })
  .strict();

export type UnlinkPaymentInput = z.infer<typeof unlinkPaymentSchema>;
export type LinkPaymentInput = z.infer<typeof linkPaymentSchema>;
export type BatchUpdateSubjectInput = z.infer<typeof batchUpdateSubjectSchema>;
export type ReconcileOrderProductReceivablesInput = z.infer<
  typeof reconcileOrderProductReceivablesSchema
>;
