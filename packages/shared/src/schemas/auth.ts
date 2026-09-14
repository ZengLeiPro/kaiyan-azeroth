import { z } from 'zod';

import { USER_STATUS, VIEW_SCOPE } from '../constants/status-values';
import { withColumn } from './column-meta';
import { COL_DATETIME, COL_NUMBER, COL_STATUS } from './column-widths';
import {
  paginationSchema,
  selectionPaginationSchema,
  stringOrStringArray,
  stringOrStringArrayOfUuid,
} from './common';

/**
 * 登录请求验证
 */
export const loginSchema = z.object({
  username: z.string().min(3, '用户名至少3个字符').max(50, '用户名最多50个字符'),
  password: z.string().min(6, '密码至少6个字符').max(100, '密码最多100个字符'),
  rememberMe: z.boolean().optional(),
});

export type LoginInput = z.infer<typeof loginSchema>;

/**
 * 刷新令牌验证
 */
export const refreshTokenSchema = z.object({
  refreshToken: z.string().min(1, 'Refresh token 不能为空'),
});

export type RefreshTokenInput = z.infer<typeof refreshTokenSchema>;

/**
 * 高风险操作重新认证
 */
export const reauthenticateSchema = z.object({
  password: z.string().min(6, '密码至少6个字符').max(100, '密码最多100个字符'),
});

export type ReauthenticateInput = z.infer<typeof reauthenticateSchema>;

/**
 * 钉钉登录请求验证
 */
export const dingtalkLoginSchema = z.object({
  code: z.string().min(1, '钉钉授权码不能为空').max(256, '钉钉授权码过长'),
  source: z.enum(['in_app', 'web']).optional(),
  state: z.string().max(256, 'state 过长').optional(),
});

export type DingtalkLoginInput = z.infer<typeof dingtalkLoginSchema>;

/**
 * 修改密码验证
 */
export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(6, '当前密码至少6个字符'),
    newPassword: z
      .string()
      .min(8, '新密码至少8个字符')
      .regex(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/, '密码必须包含大小写字母和数字'),
    confirmPassword: z.string(),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: '两次输入的密码不一致',
    path: ['confirmPassword'],
  });

export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

/**
 * 创建用户验证
 */
export const createUserSchema = z.object({
  username: z
    .string()
    .min(3, '用户名至少3个字符')
    .max(50, '用户名最多50个字符')
    .regex(/^[a-zA-Z0-9_]+$/, '用户名只能包含字母、数字和下划线'),
  phone: z
    .string()
    .regex(/^1[3-9]\d{9}$/, '请输入有效的手机号')
    .optional()
    .nullable(),
  email: z.string().email('请输入有效的邮箱').optional().nullable(),
  password: z
    .string()
    .min(8, '密码至少8个字符')
    .regex(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/, '密码必须包含大小写字母和数字'),
  avatar: z.string().optional().nullable(),
  // 必填：push 6 起 user 表已删，登录身份必须挂在 employee 上（service 层缺失会抛 409）。
  // schema 与运行时对齐，避免 CLI/前端校验放行后端却 409。update 经 updateUserSchema.partial() 自动转可选。
  employeeId: z
    .string({ required_error: '创建用户必须指定 employeeId（绑定登录员工）' })
    .uuid('employeeId 必须是 UUID'),
  roleIds: z.array(z.string().uuid()).min(1, '至少选择一个角色'),
});

export type CreateUserInput = z.infer<typeof createUserSchema>;

/**
 * 更新用户验证
 *
 * password 字段允许 admin 在「系统-用户管理」编辑表单中重置他人密码：
 * - 留空（undefined）不修改
 * - 给值则触发 service 层 bcrypt hash + 写 tokenInvalidAfter + 吊销该用户所有 sessions
 * - 沿用 createUserSchema 的强度规则（≥8 位 + 大小写字母 + 数字）
 *
 * 鉴权门：controller `RequirePermission({ menu: 'user_account', action: 'edit' })`
 */
export const updateUserSchema = createUserSchema.partial().extend({
  status: z.enum(Object.values(USER_STATUS) as [string, ...string[]]).optional(),
  version: z.coerce.number().int().min(1).optional(),
});

export type UpdateUserInput = z.infer<typeof updateUserSchema>;

export const updateUserStatusSchema = z.object({
  status: z.enum([USER_STATUS.ACTIVE, USER_STATUS.DISABLED]),
});

export type UpdateUserStatusInput = z.infer<typeof updateUserStatusSchema>;

/**
 * 角色响应验证（用于 Response DTO）
 * 注意：必须在 userResponseSchema 之前定义
 *
 * 字段 meta 供 RolesPage 消费（header/width/sortable）。
 */
export const roleResponseSchema = z.object({
  id: z.string().uuid(),
  code: withColumn(z.string(), {
    label: '角色编码',
    minWidth: 120,
    sortable: true,
    type: 'custom', // Badge variant=outline
    required: true,
  }),
  name: withColumn(z.string(), {
    label: '角色名称',
    minWidth: 140,
    sortable: true,
    type: 'text',
  }),
  description: withColumn(z.string().optional().nullable(), {
    label: '描述',
    minWidth: 180,
    type: 'custom', // muted + '-' fallback
  }),
  permissions: z.array(
    z.object({
      module: z.string(),
      menu: z.string(),
      view: z.boolean(),
      create: z.boolean(),
      edit: z.boolean(),
      delete: z.boolean(),
      export: z.boolean(),
      approve: z.boolean(),
      viewScope: z.enum([VIEW_SCOPE.SELF, VIEW_SCOPE.ALL]),
    })
  ),
  userIds: z.array(z.string().uuid()).optional(),
  status: withColumn(z.enum(['active', 'disabled']), {
    label: '状态',
    width: COL_STATUS,
    type: 'custom', // Badge 启用/禁用
  }),
  userCount: withColumn(z.number().optional(), {
    label: '用户数',
    width: COL_NUMBER,
    sortable: true,
    type: 'custom', // number 或 0
  }),
  createdAt: withColumn(z.string().optional(), {
    label: '创建时间',
    width: COL_DATETIME,
    sortable: true,
    type: 'custom', // muted + toLocaleDateString
  }),
  createdBy: z.string().optional().nullable(),
  updatedAt: z.string().optional(),
  updatedBy: z.string().optional().nullable(),
  deletedAt: z.string().optional().nullable(),
  version: z.number().optional(),
});

export type RoleResponseOutput = z.infer<typeof roleResponseSchema>;

/**
 * 用户响应验证（用于 Response DTO）
 *
 * 列 meta 供 UsersPage 消费。roles/employee/status 页面自带 Badge 渲染（未注册 statusMap
 * 的自定义 Badge），用 type:'custom' 在页面 overrides 保留原样式。
 */
export const userResponseSchema = z.object({
  id: z.string().uuid(),
  username: withColumn(z.string(), {
    label: '用户名',
    minWidth: 120,
    sortable: true,
    type: 'custom', // font-medium
    required: true,
  }),
  phone: withColumn(z.string().optional().nullable(), {
    label: '手机号',
    minWidth: 120,
    type: 'text',
  }),
  email: withColumn(z.string().optional().nullable(), {
    label: '邮箱',
    minWidth: 160,
    type: 'custom', // muted
  }),
  avatar: z.string().optional().nullable(),
  employeeId: z.string().uuid().optional().nullable(),
  roles: withColumn(z.array(roleResponseSchema), {
    label: '角色',
    minWidth: 180,
    type: 'custom', // Badge 列表
  }),
  status: withColumn(z.enum(Object.values(USER_STATUS) as [string, ...string[]]), {
    label: '状态',
    width: COL_STATUS,
    type: 'statusBadge',
    statusMapKey: 'userStatus',
  }),
  lastLoginAt: withColumn(z.string().optional().nullable(), {
    label: '最后登录',
    width: COL_DATETIME,
    type: 'custom', // muted + toLocaleString
  }),
  lastLoginIp: withColumn(z.string().optional().nullable(), {
    label: '最后登录IP',
    minWidth: 140,
    type: 'custom', // muted
  }),
  createdAt: withColumn(z.string().optional(), {
    label: '创建时间',
    width: COL_DATETIME,
    sortable: true,
    type: 'custom', // muted + toLocaleDateString
  }),
  createdBy: z.string().optional().nullable(),
  updatedAt: z.string().optional(),
  updatedBy: z.string().optional().nullable(),
  deletedAt: z.string().optional().nullable(),
  version: z.number().optional(),
  employee: withColumn(
    z
      .object({
        id: z.string().uuid(),
        name: z.string(),
      })
      .optional()
      .nullable(),
    {
      label: '关联员工',
      minWidth: 120,
      type: 'custom', // employee.name || '-'
    }
  ),
});

export type UserResponseOutput = z.infer<typeof userResponseSchema>;

/**
 * 用户查询 Schema（标准列表）
 */
export const queryUserSchema = paginationSchema.extend({
  keyword: z.string().optional(),
  status: stringOrStringArray,
  roleId: stringOrStringArrayOfUuid,
});

export type QueryUserInput = z.infer<typeof queryUserSchema>;

/**
 * 用户选择器查询 Schema
 * 用于审批流等场景的用户下拉选择器，支持大 pageSize
 */
export const userSelectionQuerySchema = selectionPaginationSchema.extend({
  status: z.preprocess(
    (val) => (val === '' ? undefined : val),
    z.enum(Object.values(USER_STATUS) as [string, ...string[]]).optional()
  ),
});

export type UserSelectionQueryInput = z.infer<typeof userSelectionQuerySchema>;

/**
 * 创建角色验证
 */
export const createRoleSchema = z.object({
  code: z
    .string()
    .min(2, '角色编码至少2个字符')
    .max(50, '角色编码最多50个字符')
    .regex(/^[A-Z_]+$/, '角色编码只能包含大写字母和下划线'),
  name: z.string().min(2, '角色名称至少2个字符').max(50, '角色名称最多50个字符'),
  description: z.string().max(200, '描述最多200个字符').optional(),
  permissions: z.array(
    z.object({
      module: z.string(),
      menu: z.string(),
      view: z.boolean().default(false),
      create: z.boolean().default(false),
      edit: z.boolean().default(false),
      delete: z.boolean().default(false),
      export: z.boolean().default(false),
      approve: z.boolean().default(false),
      viewScope: z.enum([VIEW_SCOPE.SELF, VIEW_SCOPE.ALL]).default(VIEW_SCOPE.SELF),
    })
  ),
  userIds: z.array(z.string().uuid()).optional(),
});

export type CreateRoleInput = z.infer<typeof createRoleSchema>;

/**
 * 角色表单验证 (前端使用)
 */
export const roleFormSchema = createRoleSchema.omit({ permissions: true }).extend({
  permissions: z.array(z.string()),
  viewScopes: z.record(z.string(), z.enum([VIEW_SCOPE.SELF, VIEW_SCOPE.ALL])).default({}),
  userIds: z.array(z.string().uuid()).default([]),
  description: z.string().max(200, '描述最多200个字符').optional().default(''),
});

export type RoleFormInput = z.infer<typeof roleFormSchema>;

/**
 * 更新角色验证
 */
export const updateRoleSchema = createRoleSchema.partial().extend({
  version: z.coerce.number().int().min(1).optional(),
});

export type UpdateRoleInput = z.infer<typeof updateRoleSchema>;

/**
 * 角色查询 Schema
 */
export const queryRoleSchema = paginationSchema.extend({
  keyword: z.string().optional(),
  status: z.preprocess(
    (val) => (val === '' ? undefined : val),
    z.enum(['active', 'disabled']).optional()
  ),
});

export type QueryRoleInput = z.infer<typeof queryRoleSchema>;

// ============================================================
// Auth Response Schemas
// ============================================================

/**
 * 登录响应中的简化角色 Schema
 */
const loginRoleSchema = z.object({
  id: z.string().uuid(),
  code: z.string(),
  name: z.string(),
  permissions: z.array(
    z.object({
      module: z.string(),
      menu: z.string(),
      view: z.boolean(),
      create: z.boolean(),
      edit: z.boolean(),
      delete: z.boolean(),
      export: z.boolean(),
      approve: z.boolean(),
      viewScope: z.enum([VIEW_SCOPE.SELF, VIEW_SCOPE.ALL]),
    })
  ),
});

/**
 * 已登录用户对象 Schema（login 与 me 接口共用）
 */
export const authUserSchema = z.object({
  id: z.string().uuid(),
  username: z.string(),
  phone: z.string().optional().nullable(),
  email: z.string().optional().nullable(),
  avatar: z.string().optional().nullable(),
  status: z.string(),
  roles: z.array(loginRoleSchema),
  employee: z
    .object({
      id: z.string().uuid(),
      name: z.string(),
    })
    .optional()
    .nullable(),
});

export type AuthUserOutput = z.infer<typeof authUserSchema>;

/**
 * 登录响应 Schema
 */
export const loginResponseSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  expiresIn: z.number(),
  user: authUserSchema,
});

export type LoginResponseOutput = z.infer<typeof loginResponseSchema>;

/**
 * 当前登录用户响应 Schema（GET /auth/me）
 */
export const meResponseSchema = authUserSchema;

export type MeResponseOutput = z.infer<typeof meResponseSchema>;

/**
 * 刷新令牌响应 Schema
 */
export const refreshTokenResponseSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  expiresIn: z.number(),
  user: authUserSchema,
});

export type RefreshTokenResponseOutput = z.infer<typeof refreshTokenResponseSchema>;

// ============================================================
// Personal Access Token Schemas
// ============================================================

/**
 * 签发 PAT 请求验证（仅 admin 可调用）
 *
 * push 6: 字段从 userId 改为 employeeId（user 表已删，所有身份以 employee 为准）
 */
export const issuePatSchema = z.object({
  /** 目标员工 employeeId */
  employeeId: z.string().uuid('employeeId 必须是 UUID'),
  /** 用途描述，例如 "agent-ops-bot" */
  name: z.string().min(1, 'name 不能为空').max(100, 'name 最多 100 字符'),
  /** ISO 8601 时间字符串；null/省略 = 不过期 */
  expiresAt: z.string().datetime().nullable().optional(),
});

export type IssuePatInput = z.infer<typeof issuePatSchema>;
