import type { DecimalNumber } from './common';

/**
 * 私账流水（独立物理表，与 FinanceLedger 字段对齐但无 saleOrderId/payrollRecordId）
 *
 * 物理隔离 = 权限隔离 = 误查零风险
 */
export interface IFinancePersonalLedger {
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
  importBatchId: string | null;
  createdAt: string;
  creatorEmployeeId: string | null;
  updatedAt: string;
  updaterEmployeeId: string | null;
  deletedAt: string | null;
  version: number;
}
