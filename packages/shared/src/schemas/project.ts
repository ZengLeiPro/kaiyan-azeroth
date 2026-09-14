import { z } from 'zod';

import { withColumn } from './column-meta';
import { COL_DATETIME, COL_NUMBER, COL_STATUS } from './column-widths';
import { paginationSchema, selectionPaginationSchema, stringOrStringArray } from './common';

/**
 * 项目创建 Schema
 */
export const createProjectSchema = z.object({
  name: z.string().min(1, '项目名称不能为空').max(200, '项目名称最多200个字符'),
  description: z.string().optional().nullable(),
  status: z.string().optional(),
  logicalStatus: z.string().optional().nullable(),
  category: z.string().optional().nullable(),
  customerId: z.string().uuid('客户ID格式不正确').optional().nullable(),
  opportunityId: z.string().uuid('商机ID格式不正确').optional().nullable(),
  saleOrderId: z.string().uuid('合同订单ID格式不正确').optional().nullable(),
  startDate: z.string().optional().nullable(),
  endDate: z.string().optional().nullable(),
  ownerId: z.string().optional().nullable(),
});

/**
 * 项目更新 Schema（含 version 用于乐观锁）
 */
export const updateProjectSchema = createProjectSchema.partial().extend({
  version: z.number().int().min(1),
});

/**
 * 项目查询 Schema
 */
export const queryProjectSchema = paginationSchema.extend({
  keyword: z.string().max(100).optional(),
  status: stringOrStringArray,
  category: stringOrStringArray,
  ownerId: z.string().optional(),
  customerId: z.string().uuid().optional(),
});

/**
 * 添加项目成员 Schema
 */
export const addProjectMemberSchema = z.object({
  employeeId: z.string().uuid('员工ID格式不正确'),
  userName: z.string().optional().nullable(),
  role: z.string().optional().nullable(),
});

/**
 * 项目成员 Schema
 */
export const projectMemberSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  employeeId: z.string().optional().nullable(),
  userName: z.string().optional().nullable(),
  email: z.string().optional().nullable(),
  role: z.string().optional().nullable(),
  isActive: z.boolean().optional(),
  joinedAt: z.string().optional().nullable(),
  createdAt: z.string().optional(),
  createdBy: z.string().optional().nullable(),
  updatedAt: z.string().optional(),
  updatedBy: z.string().optional().nullable(),
  deletedAt: z.string().optional().nullable(),
  version: z.number().int().min(1),
});

/**
 * 项目响应 Schema（含关联信息）
 */
/**
 * 项目关联订单简要信息 Schema
 */
export const projectSaleOrderLinkSchema = z.object({
  id: z.string(),
  saleOrderId: z.string(),
  orderTitle: z.string().optional().nullable(),
  orderAmount: z.number().optional().nullable(),
});

export const projectResponseSchema = z.object({
  id: z.string(),
  name: withColumn(z.string(), {
    label: '项目名称',
    sortable: true,
    type: 'custom',
    required: true,
    order: 10,
  }),
  description: withColumn(z.string().optional().nullable(), {
    label: '描述',
    type: 'custom',
    order: 60,
  }),
  status: withColumn(z.string(), {
    label: '状态',
    width: COL_STATUS,
    sortable: true,
    type: 'statusBadge',
    statusMapKey: 'projectStatus',
    order: 20,
  }),
  logicalStatus: z.string().optional().nullable(),
  category: withColumn(z.string().optional().nullable(), {
    label: '分类',
    width: COL_STATUS,
    type: 'statusBadge',
    statusMapKey: 'projectCategory',
    order: 30,
  }),
  customerId: z.string().optional().nullable(),
  opportunityId: z.string().optional().nullable(),
  opportunityName: z.string().optional().nullable(),
  saleOrderId: z.string().optional().nullable(),
  orderTitle: z.string().optional().nullable(),
  customerName: withColumn(z.string().optional().nullable(), {
    label: '客户',
    type: 'custom',
    order: 50,
  }),
  startDate: z.string().optional().nullable(),
  endDate: z.string().optional().nullable(),
  ownerId: z.string().optional().nullable(),
  ownerName: withColumn(z.string().optional().nullable(), {
    label: '负责人',
    type: 'custom',
    order: 40,
  }),
  /**
   * 总工时：effort_records 中 recordType='ACTUAL' 的 actualTime 求和。
   * 实时聚合（无预计算列），由 ProjectsService.findAll 走 groupBy 合并。
   */
  totalHours: withColumn(z.number().optional(), {
    label: '总工时',
    width: COL_NUMBER,
    align: 'right',
    sortable: true,
    type: 'decimal',
    order: 65,
  }),
  createdAt: withColumn(z.string().optional(), {
    label: '创建时间',
    width: COL_DATETIME,
    sortable: true,
    type: 'datetime',
    order: 70,
  }),
  createdBy: z.string().optional().nullable(),
  updatedAt: withColumn(z.string().optional(), {
    label: '最近修改',
    width: COL_DATETIME,
    sortable: true,
    type: 'datetime',
    order: 80,
  }),
  updatedBy: z.string().optional().nullable(),
  deletedAt: z.string().optional().nullable(),
  version: z.number().int().min(1),
  members: z.array(projectMemberSchema).optional(),
  saleOrders: z.array(projectSaleOrderLinkSchema).optional(),
});

/**
 * 项目选择器查询 Schema（用于下拉框）
 */
export const projectSelectionQuerySchema = selectionPaginationSchema.extend({
  status: z.string().optional(),
  category: z.string().optional(),
});

/**
 * 项目挂接销售订单 Schema（POST /projects/:id/sale-orders body）
 *
 * 单源放在 shared：原 server 端 DTO inline 定义违反 MUST-2/5。CLI / server / 前端
 * 任一方需要校验/类型时都从此处导入，避免双源漂移。
 */
export const linkSaleOrderSchema = z.object({
  saleOrderId: z.string().uuid('合同订单ID格式不正确'),
  version: z.number().int().min(1),
});

export type CreateProjectInput = z.infer<typeof createProjectSchema>;
export type UpdateProjectInput = z.infer<typeof updateProjectSchema>;
export type QueryProjectInput = z.infer<typeof queryProjectSchema>;
export type ProjectSelectionQueryInput = z.infer<typeof projectSelectionQuerySchema>;
export type AddProjectMemberInput = z.infer<typeof addProjectMemberSchema>;
export type ProjectMemberOutput = z.infer<typeof projectMemberSchema>;
export type ProjectResponseOutput = z.infer<typeof projectResponseSchema>;
export type LinkSaleOrderInput = z.infer<typeof linkSaleOrderSchema>;
