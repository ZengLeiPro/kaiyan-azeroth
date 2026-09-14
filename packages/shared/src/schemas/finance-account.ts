import { z } from 'zod';

import { withColumn } from './column-meta';
import { COL_AMOUNT, COL_NUMBER, COL_STATUS } from './column-widths';
import { paginationSchema } from './common';

/**
 * 财务账户字典 schema
 *
 * 5 行内置账户：cmb / alipay / cib / wechat / cash
 * 字典较小，UI 主要用作下拉选择器；CRUD 仅在新增账户时用
 */

/**
 * 账户类型：
 *  - virtual：虚拟主账户（如 company_total），用于挂所有 ledger 流水
 *  - bank/alipay/wechat/cash：真实账户类型，用于账户余额快照参考字典
 */
const ACCOUNT_KIND_VALUES = ['virtual', 'bank', 'alipay', 'wechat', 'cash'] as const;

export const createFinanceAccountSchema = z.object({
  code: z
    .string()
    .min(1, '账户代码不能为空')
    .max(40, '账户代码最长 40 字符')
    .regex(/^[a-z0-9_]+$/, '账户代码仅可包含小写字母/数字/下划线'),
  name: z.string().min(1, '账户名称不能为空').max(50),
  kind: z.enum(ACCOUNT_KIND_VALUES, {
    errorMap: () => ({ message: '账户类型必须是 bank/alipay/wechat/cash' }),
  }),
  currency: z.string().max(10).optional().default('CNY'),
  /** @precision Decimal */
  openingBalance: z.coerce.number().optional().default(0),
  displayOrder: z.coerce.number().int().optional().default(0),
  status: z.string().max(20).optional().default('active'),
  remark: z.string().optional().nullable(),
});

export const updateFinanceAccountSchema = createFinanceAccountSchema.partial().extend({
  version: z.number().int().optional(),
});

export const queryFinanceAccountSchema = paginationSchema.extend({
  keyword: z.string().max(100).optional(),
  kind: z.string().optional(),
  status: z.string().optional(),
});

export const financeAccountResponseSchema = z.object({
  id: z.string(),
  code: withColumn(z.string(), { label: '代码', width: COL_STATUS, type: 'text', order: 10 }),
  name: withColumn(z.string(), { label: '账户名称', width: COL_STATUS, type: 'text', order: 20 }),
  kind: withColumn(z.string(), { label: '类型', width: COL_STATUS, type: 'text', order: 30 }),
  currency: withColumn(z.string(), {
    label: '币种',
    width: COL_STATUS,
    type: 'text',
    hidden: true,
    order: 35,
  }),
  openingBalance: withColumn(z.number().optional().nullable(), {
    label: '期初余额',
    width: COL_AMOUNT,
    type: 'decimal',
    order: 40,
  }),
  displayOrder: withColumn(z.number(), {
    label: '排序',
    width: COL_NUMBER,
    type: 'custom',
    hidden: true,
    order: 50,
  }),
  status: withColumn(z.string(), { label: '状态', width: COL_STATUS, type: 'custom', order: 60 }),
  remark: z.string().optional().nullable(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
  deletedAt: z.string().optional().nullable(),
  version: z.number().optional(),
});

export type CreateFinanceAccountInput = z.infer<typeof createFinanceAccountSchema>;
export type UpdateFinanceAccountInput = z.infer<typeof updateFinanceAccountSchema>;
export type QueryFinanceAccountInput = z.infer<typeof queryFinanceAccountSchema>;
export type FinanceAccountResponseOutput = z.infer<typeof financeAccountResponseSchema>;
