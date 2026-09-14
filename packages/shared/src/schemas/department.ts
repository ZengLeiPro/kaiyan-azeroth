import { z } from 'zod';

import { paginationSchema, selectionPaginationSchema } from './common';

/**
 * 部门创建 Schema
 */
export const createDepartmentSchema = z.object({
  name: z.string().min(1, '部门名称不能为空').max(100, '部门名称最多100个字符'),
  parentId: z.string().uuid().optional().nullable(),
  sortOrder: z.coerce.number().int().optional().nullable(),
  managerId: z.string().optional().nullable(),
  status: z.string().optional().nullable(),
});

/**
 * 部门更新 Schema（含 version 用于乐观锁）
 */
export const updateDepartmentSchema = createDepartmentSchema.partial().extend({
  version: z.number().int().optional(),
});

/**
 * 部门查询 Schema
 */
export const queryDepartmentSchema = paginationSchema.extend({
  keyword: z.string().max(100).optional(),
  status: z.string().optional(),
  parentId: z.string().uuid().optional(),
});

/**
 * 部门员工查询 Schema（分页）
 */
export const queryDepartmentEmployeesSchema = paginationSchema.extend({
  keyword: z.string().max(100).optional(),
});

/**
 * 添加员工到部门 Schema
 */
export const addEmployeeToDepartmentSchema = z.object({
  employeeId: z.string().min(1, '员工 ID 不能为空'),
  isPrimary: z.boolean().optional().default(false),
});

/**
 * 设置员工所属部门 Schema
 */
export const setEmployeeDepartmentsSchema = z.object({
  departmentIds: z.array(z.string()).min(1, '至少选择一个部门'),
  primaryDepartmentId: z.string().optional().nullable(),
});

/**
 * 设置部门负责人 Schema
 */
export const setDepartmentManagersSchema = z.object({
  managerId: z.string().optional().nullable(),
  version: z.number().int().optional(),
});

/**
 * 部门选择器 Schema（简化字段）
 */
export const departmentForSelectionSchema = z.object({
  id: z.string(),
  name: z.string(),
  parentId: z.string().optional().nullable(),
});

/**
 * 部门响应 Schema（含关联信息）
 */
export const departmentResponseSchema = z.object({
  id: z.string(),
  name: z.string(),
  parentId: z.string().optional().nullable(),
  sortOrder: z.number(),
  status: z.string(),
  managerId: z.string().optional().nullable(),
  dingtalkDeptId: z.number().optional().nullable(),
  dingtalkParentId: z.number().optional().nullable(),
  createDeptGroup: z.boolean().optional(),
  autoAddUser: z.boolean().optional(),
  lastSyncAt: z.string().optional().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  version: z.number().optional(),
  parent: departmentForSelectionSchema.optional().nullable(),
  manager: z
    .object({
      id: z.string(),
      name: z.string(),
    })
    .optional()
    .nullable(),
  employeeCount: z.number().optional(),
  childrenCount: z.number().optional(),
});

/**
 * 部门选择器查询 Schema（用于下拉框）
 */
export const departmentSelectionQuerySchema = selectionPaginationSchema.extend({
  status: z.string().optional(),
});

export type CreateDepartmentInput = z.infer<typeof createDepartmentSchema>;
export type UpdateDepartmentInput = z.infer<typeof updateDepartmentSchema>;
export type QueryDepartmentInput = z.infer<typeof queryDepartmentSchema>;
export type QueryDepartmentEmployeesInput = z.infer<typeof queryDepartmentEmployeesSchema>;
export type AddEmployeeToDepartmentInput = z.infer<typeof addEmployeeToDepartmentSchema>;
export type SetEmployeeDepartmentsInput = z.infer<typeof setEmployeeDepartmentsSchema>;
export type SetDepartmentManagersInput = z.infer<typeof setDepartmentManagersSchema>;
export type DepartmentSelectionQueryInput = z.infer<typeof departmentSelectionQuerySchema>;
export type DepartmentForSelectionOutput = z.infer<typeof departmentForSelectionSchema>;
export type DepartmentResponseOutput = z.infer<typeof departmentResponseSchema>;

// 部门员工列表项响应（GET /departments/:id/employees）
export const departmentEmployeeItemSchema = z.object({
  id: z.string(),
  name: z.string(),
  serialNumber: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
  position: z.string().nullable().optional(),
  status: z.string().nullable().optional(),
  isPrimary: z.boolean(),
});

export type DepartmentEmployeeItemOutput = z.infer<typeof departmentEmployeeItemSchema>;
