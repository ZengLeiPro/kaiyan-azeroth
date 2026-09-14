import type { DecimalNumber } from './common';

/**
 * 财务流水（公司账主表，不含「个人」）
 *
 * runningBalance 不存储，service 层按 accountId 累加注入
 */
export interface IFinanceLedger {
  id: string;
  /** YYYY-MM-DD */
  txDate: string;
  accountId: string;
  subjectId: string;
  /** @precision Decimal 正=收入 负=支出 */
  amount: DecimalNumber;
  /** 'in' / 'out' */
  direction: string;
  remark: string | null;
  /** 'dingtalk_import' / 'manual' */
  source: string;
  dingtalkSheetName: string | null;
  dingtalkRowIndex: number | null;
  dingtalkRowHash: string | null;
  saleOrderId: string | null;
  payrollRecordId: string | null;
  importBatchId: string | null;
  createdAt: string;
  creatorEmployeeId: string | null;
  updatedAt: string;
  updaterEmployeeId: string | null;
  deletedAt: string | null;
  version: number;
}
