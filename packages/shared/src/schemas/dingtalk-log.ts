import { z } from 'zod';

import { withColumn } from './column-meta';
import { COL_DATETIME } from './column-widths';
import { paginationSchema } from './common';

/**
 * 钉钉日志查询 Schema
 */
export const queryDingtalkLogSchema = paginationSchema.extend({
  keyword: z.string().max(100).optional(),
  creatorId: z.string().optional(),
  templateName: z.string().optional(),
});

export type QueryDingtalkLogInput = z.infer<typeof queryDingtalkLogSchema>;

/**
 * 钉钉日志结构化正文段（[{key, value}]）
 */
export const dingtalkLogSectionSchema = z.object({
  key: z.string().min(1, '段标题必填').max(50, '段标题不超过 50 字'),
  value: z.string().max(5000, '段内容不超过 5000 字'),
});

export type DingtalkLogSection = z.infer<typeof dingtalkLogSectionSchema>;

/**
 * 钉钉日志新增 Schema（本地新增，source 强制为 'local'）
 *
 * 仅本地新增——不调用钉钉 OAPI（OAPI 也不开放修改/删除接口）。
 */
export const createDingtalkLogSchema = z.object({
  templateName: z.string().max(50, '模板名不超过 50 字').optional().nullable(),
  /** 提交人员工 ID（本地新增表单从 EmployeeSelect 选出；钉钉同步走 service 内部回填） */
  creatorId: z.string().max(50, 'creatorId 不超过 50 字').optional().nullable(),
  creatorName: z.string().max(100, '提交人不超过 100 字').optional().nullable(),
  deptName: z.string().max(100, '部门名不超过 100 字').optional().nullable(),
  /** 结构化正文段，至少 1 段 */
  sections: z.array(dingtalkLogSectionSchema).min(1, '至少填写一段内容'),
  /** 业务发生时间（报告日期），不填默认当前时间 */
  createTime: z.string().datetime().optional(),
});

export type CreateDingtalkLogInput = z.infer<typeof createDingtalkLogSchema>;

/**
 * 钉钉日志编辑 Schema（本地编辑——同步过来的钉钉日志编辑后会被标记为已本地编辑，
 * 不再被增量同步覆盖）
 */
export const updateDingtalkLogSchema = createDingtalkLogSchema.partial();

export type UpdateDingtalkLogInput = z.infer<typeof updateDingtalkLogSchema>;

/**
 * 钉钉日志响应 Schema
 */
export const dingtalkLogResponseSchema = z.object({
  reportId: z.string(),
  templateName: withColumn(z.string().optional().nullable(), {
    label: '日志模板',
    minWidth: 180,
    type: 'custom',
    required: true,
  }),
  creatorId: z.string().optional().nullable(),
  creatorName: withColumn(z.string().optional().nullable(), {
    label: '提交人',
    minWidth: 120,
    type: 'custom',
    exportFormatterKey: 'text',
  }),
  deptName: withColumn(z.string().optional().nullable(), {
    label: '部门',
    minWidth: 140,
    type: 'custom',
    exportFormatterKey: 'text',
  }),
  contents: withColumn(z.string().optional().nullable(), {
    label: '日志内容',
    minWidth: 240,
    type: 'custom',
    exportIgnore: true,
  }),
  /** 结构化正文段（本地新增/编辑的日志主要存这里） */
  contentsJson: z.array(dingtalkLogSectionSchema).optional().nullable(),
  createTime: withColumn(z.string().optional().nullable(), {
    label: '创建时间',
    width: COL_DATETIME,
    type: 'datetime',
    sortable: true,
    exportFormatterKey: 'datetime',
  }),
  syncedAt: withColumn(z.string().optional().nullable(), {
    label: '同步时间',
    width: COL_DATETIME,
    type: 'datetime',
    exportFormatterKey: 'datetime',
  }),
  /** 来源：dingtalk=同步自钉钉；local=本地新增 */
  source: withColumn(z.enum(['dingtalk', 'local']).optional(), {
    label: '来源',
    width: 80,
    type: 'custom',
  }),
  /** 是否被本地编辑过 */
  isLocallyEdited: z.boolean().optional(),
  updatedAt: z.string().optional().nullable(),
});

export type DingtalkLogResponseOutput = z.infer<typeof dingtalkLogResponseSchema>;
