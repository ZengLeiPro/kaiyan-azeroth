import { z } from 'zod';

import { paginationSchema, stringOrStringArray, stringOrStringArrayOfUuid } from './common';
import {
  createFinanceLedgerSchema,
  FINANCE_LEDGER_DIRECTION_VALUES,
  financeLedgerResponseSchema,
} from './finance-ledger';

/**
 * 财务私账流水 schema
 *
 * 与公司账（FinanceLedger）字段对齐，但去掉 saleOrderId / payrollRecordId（私账与 CRM/HR 不挂钩）。
 * 物理隔离 + 权限隔离 = DB 层杜绝误查（即使代码忘加 isPersonal 过滤也不会泄漏）。
 *
 * schema 复用 finance-ledger，避免重复维护。
 */

export const createFinancePersonalLedgerSchema = createFinanceLedgerSchema.omit({
  saleOrderId: true,
  payrollRecordId: true,
});

export const updateFinancePersonalLedgerSchema = createFinancePersonalLedgerSchema
  .partial()
  .extend({
    version: z.number().int().optional(),
  });

export const queryFinancePersonalLedgerSchema = paginationSchema.extend({
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

export const financePersonalLedgerResponseSchema = financeLedgerResponseSchema.omit({
  saleOrderId: true,
  payrollRecordId: true,
});

export type CreateFinancePersonalLedgerInput = z.infer<typeof createFinancePersonalLedgerSchema>;
export type UpdateFinancePersonalLedgerInput = z.infer<typeof updateFinancePersonalLedgerSchema>;
export type QueryFinancePersonalLedgerInput = z.infer<typeof queryFinancePersonalLedgerSchema>;
export type FinancePersonalLedgerResponseOutput = z.infer<
  typeof financePersonalLedgerResponseSchema
>;
