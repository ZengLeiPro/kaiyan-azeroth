/**
 * 财务科目字典（P&L 树）
 *
 * 67 个 P&L 科目：14 个分组 + 54 个叶子
 * level=1=分组（不可挂账），level=2=叶子（可挂账）
 * category：revenue / cogs / opex / tax / other_income / non_pl
 */
export interface IFinanceSubject {
  id: string;
  code: string;
  name: string;
  /** revenue / cogs / opex / tax / other_income / non_pl */
  category: string;
  /** 1=分组 / 2=叶子 */
  level: number;
  parentId: string | null;
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
