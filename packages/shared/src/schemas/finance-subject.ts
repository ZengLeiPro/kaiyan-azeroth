import { z } from 'zod';

import { withColumn } from './column-meta';
import { COL_NUMBER, COL_STATUS } from './column-widths';
import { paginationSchema, stringOrStringArray } from './common';

/**
 * 财务科目字典 schema
 *
 * 67 个 P&L 科目：14 个分组 + 54 个叶子
 * category：revenue / cogs / opex / tax / other_income / non_pl
 * level：1=分组（不可挂账） / 2=叶子（可挂账）
 */

export const FINANCE_SUBJECT_CATEGORY_VALUES = [
  'revenue',
  'cogs',
  'opex',
  'tax',
  'other_income',
  'non_pl',
] as const;

export const FINANCE_SUBJECT_LEVEL_VALUES = [1, 2] as const;

export const createFinanceSubjectSchema = z.object({
  code: z
    .string()
    .min(1, '科目代码不能为空')
    .max(60, '科目代码最长 60 字符')
    .regex(/^[a-z0-9_.]+$/, '科目代码仅可包含小写字母/数字/下划线/点'),
  name: z.string().min(1, '科目名称不能为空').max(80),
  category: z.enum(FINANCE_SUBJECT_CATEGORY_VALUES),
  level: z
    .union([z.literal(1), z.literal(2)])
    .default(2)
    .optional(),
  parentId: z.string().uuid().optional().nullable(),
  displayOrder: z.coerce.number().int().optional().default(0),
  status: z.string().max(20).optional().default('active'),
  remark: z.string().optional().nullable(),
});

export const updateFinanceSubjectSchema = createFinanceSubjectSchema.partial().extend({
  version: z.number().int().optional(),
});

export const queryFinanceSubjectSchema = paginationSchema.extend({
  keyword: z.string().max(100).optional(),
  category: stringOrStringArray,
  level: z.coerce.number().int().optional(),
  parentId: z.string().uuid().optional(),
  status: z.string().optional(),
  /** as=tree 返回树形结构 */
  as: z.enum(['flat', 'tree']).optional().default('flat'),
});

export const financeSubjectResponseSchema = z.object({
  id: z.string(),
  code: withColumn(z.string(), { label: '代码', width: COL_STATUS, type: 'text', order: 10 }),
  name: withColumn(z.string(), { label: '科目名称', width: COL_STATUS, type: 'text', order: 20 }),
  category: withColumn(z.string(), { label: '大类', width: COL_STATUS, type: 'custom', order: 30 }),
  level: withColumn(z.number(), { label: '层级', width: COL_NUMBER, type: 'custom', order: 40 }),
  parentId: z.string().optional().nullable(),
  parentName: z.string().optional().nullable(),
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

export type CreateFinanceSubjectInput = z.infer<typeof createFinanceSubjectSchema>;
export type UpdateFinanceSubjectInput = z.infer<typeof updateFinanceSubjectSchema>;
export type QueryFinanceSubjectInput = z.infer<typeof queryFinanceSubjectSchema>;
export type FinanceSubjectResponseOutput = z.infer<typeof financeSubjectResponseSchema>;
