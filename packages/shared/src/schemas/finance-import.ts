import { z } from 'zod';

import { paginationSchema } from './common';

/**
 * 财务导入（外部回款表表迁移）schema
 *
 * 双阶段：
 *  1. preview：解析 + 双对账（账户余额勾稽 + 财报 sheet 勾稽），不写 ledger 表
 *  2. commit：从 batch.previewJson 反序列化重放，写入 ledger
 */

export const FINANCE_IMPORT_STRATEGY_VALUES = ['replace_year', 'append_only'] as const;
export const FINANCE_IMPORT_STATUS_VALUES = ['pending', 'preview', 'committed', 'failed'] as const;

/** Preview 入参：指定 workbookId + 年份范围 */
export const financeImportPreviewInputSchema = z.object({
  workbookId: z.string().min(1, 'workbookId 不能为空'),
  years: z.array(z.coerce.number().int().min(2020).max(2099)).min(1, '至少选择一个年份'),
});

/** Commit 入参：基于 preview 出的 batchId 反序列化重放 */
export const financeImportCommitInputSchema = z.object({
  batchId: z.string().uuid('batchId 格式不正确'),
  strategy: z.enum(FINANCE_IMPORT_STRATEGY_VALUES).default('replace_year'),
});

/** 单行对账 diff（账户余额勾稽） */
export const financeBalanceDiffSchema = z.object({
  sheetName: z.string(),
  rowIndex: z.number(),
  accountCode: z.string(),
  expected: z.number(),
  actual: z.number(),
  diff: z.number(),
});

/** 单格对账 diff（财报 sheet 勾稽） */
export const financePnlDiffSchema = z.object({
  year: z.number(),
  month: z.number(),
  subjectCode: z.string(),
  subjectName: z.string(),
  expected: z.number(),
  actual: z.number(),
  diff: z.number(),
});

/** 双对账完整结果 */
export const financeReconciliationSchema = z.object({
  passed: z.boolean(),
  balanceDiffs: z.array(financeBalanceDiffSchema),
  pnlDiffs: z.array(financePnlDiffSchema),
});

/** 解析错误 */
export const financeImportErrorSchema = z.object({
  sheetName: z.string(),
  rowIndex: z.number(),
  reason: z.string(),
  rawData: z.record(z.string(), z.unknown()).optional(),
});

/** Preview 出参 */
export const financeImportPreviewResponseSchema = z.object({
  batchId: z.string(),
  summary: z.object({
    totalRows: z.number(),
    companyRows: z.number(),
    personalRows: z.number(),
    errorRows: z.number(),
  }),
  reconciliation: financeReconciliationSchema,
  errors: z.array(financeImportErrorSchema),
});

/** Commit 出参 */
export const financeImportCommitResponseSchema = z.object({
  batchId: z.string(),
  status: z.string(),
  successRows: z.number(),
  personalRows: z.number(),
  skippedRows: z.number(),
  failedRows: z.number(),
});

/** 批次列表查询 */
export const queryFinanceImportBatchSchema = paginationSchema.extend({
  status: z.enum(FINANCE_IMPORT_STATUS_VALUES).optional(),
  source: z.string().optional(),
});

type FinanceImportJsonValue =
  | string
  | number
  | boolean
  | null
  | FinanceImportJsonValue[]
  | { [key: string]: FinanceImportJsonValue };

const financeImportJsonValueSchema: z.ZodType<FinanceImportJsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(financeImportJsonValueSchema),
    z.record(financeImportJsonValueSchema),
  ])
);

/**
 * 批次详情 API 契约。
 *
 * 审计时间统一输出 ISO 8601 字符串；数据库可空字段在响应中始终存在并以 null 表示空值。
 */
export const financeImportBatchResponseSchema = z.object({
  id: z.string(),
  source: z.string(),
  workbookId: z.string().nullable(),
  sheetNames: z.array(z.string()),
  totalRows: z.number().int(),
  successRows: z.number().int(),
  skippedRows: z.number().int(),
  failedRows: z.number().int(),
  personalRows: z.number().int(),
  status: z.enum(FINANCE_IMPORT_STATUS_VALUES),
  previewJson: financeImportJsonValueSchema,
  summaryJson: financeImportJsonValueSchema,
  errorReportJson: financeImportJsonValueSchema,
  reconciliationJson: financeReconciliationSchema.nullable(),
  createdAt: z.string().datetime(),
  creatorEmployeeId: z.string().nullable(),
  updatedAt: z.string().datetime(),
  updaterEmployeeId: z.string().nullable(),
  deletedAt: z.string().datetime().nullable(),
  version: z.number().int(),
});

export type FinanceImportPreviewInput = z.infer<typeof financeImportPreviewInputSchema>;
export type FinanceImportCommitInput = z.infer<typeof financeImportCommitInputSchema>;
export type FinanceImportPreviewResponse = z.infer<typeof financeImportPreviewResponseSchema>;
export type FinanceImportCommitResponse = z.infer<typeof financeImportCommitResponseSchema>;
export type FinanceImportBatchResponse = z.infer<typeof financeImportBatchResponseSchema>;
export type FinanceReconciliation = z.infer<typeof financeReconciliationSchema>;
export type FinanceBalanceDiff = z.infer<typeof financeBalanceDiffSchema>;
export type FinancePnlDiff = z.infer<typeof financePnlDiffSchema>;
export type QueryFinanceImportBatchInput = z.infer<typeof queryFinanceImportBatchSchema>;
