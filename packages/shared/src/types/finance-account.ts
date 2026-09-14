import type { DecimalNumber } from './common';

/**
 * 财务账户字典
 *
 * 6 行内置账户：1 虚拟主账户 company_total + 5 真实账户（招行/支付宝/兴业/微信/现金）
 * 真实账户作为「余额快照」字典使用，不挂 ledger
 */
export interface IFinanceAccount {
  id: string;
  code: string;
  name: string;
  /** virtual / bank / alipay / wechat / cash */
  kind: string;
  currency: string;
  /** @precision Decimal */
  openingBalance: DecimalNumber;
  displayOrder: number;
  status: string;
  remark: string | null;
  createdAt: string;
  creatorEmployeeId: string | null;
  updatedAt: string;
  updaterEmployeeId: string | null;
  deletedAt: string | null;
  version: number;
}
