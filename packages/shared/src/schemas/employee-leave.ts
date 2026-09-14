import { z } from 'zod';

import { withColumn } from './column-meta';
import { COL_DATE, COL_DATETIME } from './column-widths';
import { paginationSchema } from './common';

/**
 * 员工请假查询 Schema（只读实体，无 create/update）
 */
export const queryEmployeeLeaveSchema = paginationSchema.extend({
  keyword: z.string().max(100).optional(),
  dingtalkUserId: z.string().optional(),
});

export type QueryEmployeeLeaveInput = z.infer<typeof queryEmployeeLeaveSchema>;

/**
 * 员工离职记录响应 Schema
 */
export const employeeLeaveResponseSchema = z.object({
  id: z.string(),
  dingtalkUserId: z.string(),
  name: withColumn(z.string(), {
    label: '姓名',
    minWidth: 120,
    type: 'custom', // 加粗
    required: true,
  }),
  mobile: withColumn(z.string().optional().nullable(), {
    label: '手机号',
    minWidth: 120,
    type: 'custom', // muted 文字
  }),
  leaveTime: withColumn(z.string().optional().nullable(), {
    label: '离职时间',
    width: COL_DATE,
    type: 'date',
  }),
  leaveReason: withColumn(z.string().optional().nullable(), {
    label: '离职原因',
    minWidth: 180,
    type: 'custom', // muted + 30 字截断
  }),
  syncedAt: withColumn(z.string().optional().nullable(), {
    label: '同步时间',
    width: COL_DATETIME,
    type: 'datetime',
  }),
});

export type EmployeeLeaveResponseOutput = z.infer<typeof employeeLeaveResponseSchema>;
