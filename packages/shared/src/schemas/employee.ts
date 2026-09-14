import { z } from 'zod';

import { USER_STATUS } from '../constants/status-values';
import { withColumn } from './column-meta';
import {
  COL_AMOUNT,
  COL_DATE,
  COL_DATETIME,
  COL_IP,
  COL_NUMBER,
  COL_SERIAL,
  COL_STATUS,
  COL_STATUS_SM,
} from './column-widths';
import { paginationSchema, selectionPaginationSchema, stringOrStringArray } from './common';

/**
 * 员工创建 Schema
 */
export const createEmployeeSchema = z.object({
  name: z.string().min(1, '姓名不能为空').max(50, '姓名最多50个字符'),
  phone: z.string().max(20, '手机号最多20个字符').optional().nullable(),
  email: z.string().max(100, '邮箱最多100个字符').optional().nullable(),
  gender: z.string().optional().nullable(),
  entryDate: z.string().optional().nullable(),
  position: z.string().optional().nullable(),
  status: z.string().optional(),
  avatar: z.string().optional().nullable(),
  /** 所属部门 ID 列表（多部门） */
  departmentIds: z.array(z.string()).optional(),
  /** 主部门 ID */
  primaryDepartmentId: z.string().optional().nullable(),
  /** 工时单价（元/小时） @precision Decimal */
  hourlyRate: z.coerce.number().min(0).optional().nullable(),
});

/**
 * 员工更新 Schema（含 version 用于乐观锁）
 *
 * 钉钉身份字段必须通过 受保护管理端点绑定接口修改，普通员工资料更新明确拒绝这些字段。
 */
export const updateEmployeeSchema = createEmployeeSchema
  .partial()
  .extend({
    version: z.number().int().optional(),
  })
  .strict();

const dingtalkBindingVersionSchema = z.number().int().positive('version 必须是正整数');
const dingtalkIdentitySchema = z.string().trim().min(1, '钉钉身份ID不能为空').max(50);
const expectedDingtalkIdentitySchema = dingtalkIdentitySchema.nullable();

/** 管理员 以显式旧身份快照 CAS 完整替换员工钉钉身份绑定。 */
export const bindEmployeeDingtalkSchema = z
  .object({
    version: dingtalkBindingVersionSchema,
    expectedDingtalkUserId: expectedDingtalkIdentitySchema,
    expectedDingtalkUnionId: expectedDingtalkIdentitySchema,
    dingtalkUserId: dingtalkIdentitySchema,
    dingtalkUnionId: dingtalkIdentitySchema,
  })
  .strict();

/** 管理员 以显式旧身份快照 CAS 原子清空员工钉钉身份绑定。 */
export const unbindEmployeeDingtalkSchema = z
  .object({
    version: dingtalkBindingVersionSchema,
    expectedDingtalkUserId: expectedDingtalkIdentitySchema,
    expectedDingtalkUnionId: expectedDingtalkIdentitySchema,
  })
  .strict();

/**
 * 员工查询 Schema
 */
export const queryEmployeeSchema = paginationSchema.extend({
  keyword: z.string().max(100).optional(),
  status: stringOrStringArray,
  /** 部门 ID（通过员工-部门关联表筛选） */
  departmentId: z.string().optional(),
});

/**
 * 员工选择器查询 Schema（用于下拉框）
 *
 * loginStatus：登录状态（active/disabled/locked），默认仅返回登录启用的员工。
 * 若需按"在职状态"过滤，请走 queryEmployeeSchema 的 status 字段。
 *
 * roleCodes：按角色 code 过滤（如 ['PM', 'DEVELOPER']），调用方按场景指定。
 *   例如工时统计的「记录人」只需展示 PM 与 DEVELOPER。
 *   服务端在 UserRole.role.code IN (...) 上做 some 匹配，未传则不过滤。
 */
export const employeesSelectionQuerySchema = selectionPaginationSchema.extend({
  loginStatus: z.string().optional(),
  departmentId: z.string().optional(),
  roleCodes: stringOrStringArray,
});

/**
 * 员工部门信息 Schema
 */
export const employeeDepartmentInfoSchema = z.object({
  id: z.string(),
  departmentId: z.string(),
  departmentName: z.string(),
  isPrimary: z.boolean(),
});

/**
 * 员工响应 Schema（含关联信息）
 *
 * 列 UI 元数据附着在字段 schema 上，供前端 `deriveColumnsFromSchema` 派生表格列。
 * `genderMap` / `employeeStatusMap` 未注册到 column-renderers（避免并发冲突），
 * 用 `type: 'custom'` + 页面 overrides 保留原 StatusBadge。
 *
 * 注：`departmentName` 是前端 `transformData` 从 `primaryDepartment.departmentName`
 * 展平的视图字段；schema 登记以获得列 meta。
 */
export const employeeResponseSchema = z.object({
  id: withColumn(z.string(), {
    label: 'ID',
    minWidth: 220,
    type: 'text',
    order: 1,
  }),
  name: withColumn(z.string(), {
    label: '姓名',
    sortable: true,
    type: 'text',
    required: true,
    order: 30,
  }),
  serialNumber: withColumn(z.string(), {
    label: '工号',
    width: COL_SERIAL,
    sortable: true,
    type: 'text',
    order: 10,
  }),
  phone: withColumn(z.string().optional().nullable(), {
    label: '手机号',
    type: 'custom',
    order: 90,
  }),
  email: withColumn(z.string().optional().nullable(), {
    label: '邮箱',
    type: 'custom',
    order: 100,
  }),
  gender: withColumn(z.string().optional().nullable(), {
    label: '性别',
    width: COL_STATUS_SM,
    type: 'statusBadge',
    statusMapKey: 'gender',
    order: 40,
  }),
  position: withColumn(z.string().optional().nullable(), {
    label: '职位',
    type: 'custom',
    order: 60,
  }),
  /** 工时单价（元/小时） @precision Decimal */
  hourlyRate: withColumn(z.coerce.number().optional().nullable(), {
    label: '工时单价',
    width: COL_AMOUNT,
    sortable: true,
    align: 'right',
    type: 'custom',
    order: 65,
  }),
  status: withColumn(z.string(), {
    label: '员工状态',
    width: COL_STATUS,
    sortable: true,
    type: 'statusBadge',
    statusMapKey: 'employeeStatus',
    order: 120,
  }),
  entryDate: withColumn(z.string().optional().nullable(), {
    label: '入职日期',
    width: COL_DATE,
    sortable: true,
    type: 'custom',
    order: 140,
  }),
  avatar: withColumn(z.string().optional().nullable(), {
    label: '头像',
    minWidth: 180,
    type: 'custom',
    order: 115,
  }),
  username: withColumn(z.string().optional().nullable(), {
    label: '登录用户名',
    minWidth: 140,
    sortable: true,
    type: 'custom',
    order: 150,
  }),
  loginStatus: withColumn(z.enum(Object.values(USER_STATUS) as [string, ...string[]]).optional(), {
    label: '登录状态',
    width: COL_STATUS,
    sortable: true,
    type: 'statusBadge',
    statusMapKey: 'userStatus',
    order: 160,
  }),
  canLogin: withColumn(z.boolean().optional(), {
    label: '可登录',
    width: COL_STATUS_SM,
    sortable: true,
    type: 'custom',
    order: 170,
  }),
  lastLoginAt: withColumn(z.string().optional().nullable(), {
    label: '最后登录',
    width: COL_DATETIME,
    type: 'custom',
    order: 180,
  }),
  lastLoginIp: withColumn(z.string().optional().nullable(), {
    label: '最后登录IP',
    width: COL_IP,
    type: 'custom',
    order: 190,
  }),
  loginFailCount: withColumn(z.number().int().optional(), {
    label: '失败次数',
    width: COL_NUMBER,
    align: 'right',
    type: 'custom',
    order: 200,
  }),
  lockUntil: withColumn(z.string().optional().nullable(), {
    label: '锁定到',
    width: COL_DATETIME,
    type: 'custom',
    order: 210,
  }),
  tokenInvalidAfter: withColumn(z.string().optional().nullable(), {
    label: '令牌失效点',
    width: COL_DATETIME,
    type: 'custom',
    order: 220,
  }),
  dingtalkUserId: withColumn(z.string().optional().nullable(), {
    label: '钉钉用户ID',
    minWidth: 160,
    type: 'custom',
    order: 230,
  }),
  dingtalkUnionId: withColumn(z.string().optional().nullable(), {
    label: '钉钉UnionId',
    minWidth: 160,
    type: 'custom',
    order: 240,
  }),
  jobNumber: withColumn(z.string().optional().nullable(), {
    label: '钉钉工号',
    width: COL_SERIAL,
    type: 'custom',
    order: 20,
  }),
  workPlace: withColumn(z.string().optional().nullable(), {
    label: '办公地点',
    type: 'custom',
    order: 110,
  }),
  isAdmin: withColumn(z.boolean().optional(), {
    label: '身份',
    type: 'custom',
    order: 70,
  }),
  isBoss: z.boolean().optional(),
  isLeader: z.boolean().optional(),
  dingtalkActive: withColumn(z.boolean().optional(), {
    label: '钉钉激活',
    width: COL_STATUS,
    type: 'custom',
    order: 130,
  }),
  dingtalkExtension: withColumn(z.record(z.unknown()).optional().nullable(), {
    label: '钉钉扩展',
    width: COL_STATUS,
    type: 'custom',
    order: 270,
  }),
  lastSyncAt: withColumn(z.string().optional().nullable(), {
    label: '最后同步',
    width: COL_DATETIME,
    type: 'custom',
    order: 280,
  }),
  createdAt: withColumn(z.string().optional(), {
    label: '创建时间',
    width: COL_DATETIME,
    sortable: true,
    type: 'custom',
    order: 290,
  }),
  createdBy: withColumn(z.string().optional().nullable(), {
    label: '创建人ID',
    minWidth: 180,
    type: 'custom',
    order: 300,
  }),
  updatedAt: withColumn(z.string().optional(), {
    label: '更新时间',
    width: COL_DATETIME,
    sortable: true,
    type: 'custom',
    order: 310,
  }),
  updatedBy: withColumn(z.string().optional().nullable(), {
    label: '更新人ID',
    minWidth: 180,
    type: 'custom',
    order: 320,
  }),
  deletedAt: withColumn(z.string().optional().nullable(), {
    label: '删除时间',
    width: COL_DATETIME,
    type: 'custom',
    order: 330,
  }),
  version: withColumn(z.number().optional(), {
    label: '版本',
    width: COL_NUMBER,
    align: 'right',
    type: 'custom',
    order: 340,
  }),
  departments: withColumn(z.array(employeeDepartmentInfoSchema).optional(), {
    label: '所属部门',
    minWidth: 180,
    type: 'custom',
    order: 52,
  }),
  primaryDepartment: employeeDepartmentInfoSchema.optional().nullable(),
  departmentName: withColumn(z.string().optional().nullable(), {
    label: '主部门',
    type: 'custom',
    order: 50,
  }),
});

export type CreateEmployeeInput = z.infer<typeof createEmployeeSchema>;
export type UpdateEmployeeInput = z.infer<typeof updateEmployeeSchema>;
export type QueryEmployeeInput = z.infer<typeof queryEmployeeSchema>;
export type EmployeesSelectionQueryInput = z.infer<typeof employeesSelectionQuerySchema>;
export type EmployeeDepartmentInfoOutput = z.infer<typeof employeeDepartmentInfoSchema>;
export type EmployeeResponseOutput = z.infer<typeof employeeResponseSchema>;
