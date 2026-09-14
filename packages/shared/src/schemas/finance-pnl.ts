import { z } from 'zod';

import { paginationSchema } from './common';

/**
 * 财务损益表（P&L）schema
 *
 * 按年聚合：科目 × 月份 矩阵
 * 后端实时 raw SQL `GROUP BY subject_id, EXTRACT(MONTH FROM tx_date)` 派生，不落表
 */

// @no-pagination —— PnL 矩阵按年聚合，不分页
export const queryFinancePnlSchema = z.object({
  year: z.coerce.number().int().min(2020).max(2099),
});

/** 单行：一个科目的 12 月 + 全年 */
export const financePnlRowSchema = z.object({
  subjectId: z.string(),
  subjectCode: z.string(),
  subjectName: z.string(),
  category: z.string(),
  level: z.number(),
  parentCode: z.string().optional().nullable(),
  displayOrder: z.number(),
  months: z.object({
    1: z.number(),
    2: z.number(),
    3: z.number(),
    4: z.number(),
    5: z.number(),
    6: z.number(),
    7: z.number(),
    8: z.number(),
    9: z.number(),
    10: z.number(),
    11: z.number(),
    12: z.number(),
  }),
  total: z.number(),
});

export const financePnlResponseSchema = z.object({
  year: z.number(),
  subjects: z.array(financePnlRowSchema),
  categoryTotals: z.record(z.string(), z.number()),
  grandTotals: z.object({
    revenue: z.number(),
    cogs: z.number(),
    grossProfit: z.number(),
    grossMargin: z.number(),
    opex: z.number(),
    profitBeforeTax: z.number(),
    tax: z.number(),
    otherIncome: z.number(),
    netProfit: z.number(),
    netMargin: z.number(),
  }),
});

/** 下钻（点 PnL 矩阵某格）查询：返回该格命中的 ledger 明细 */
export const queryFinancePnlDrilldownSchema = paginationSchema.extend({
  year: z.coerce.number().int().min(2020).max(2099),
  month: z.coerce.number().int().min(1).max(12),
  subjectCode: z.string().min(1),
});

export type QueryFinancePnlInput = z.infer<typeof queryFinancePnlSchema>;
export type FinancePnlResponse = z.infer<typeof financePnlResponseSchema>;
export type FinancePnlRow = z.infer<typeof financePnlRowSchema>;
export type QueryFinancePnlDrilldownInput = z.infer<typeof queryFinancePnlDrilldownSchema>;
