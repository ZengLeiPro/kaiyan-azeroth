import { z } from 'zod';

import { NOTIFICATION_TYPE } from '../constants/notification';
import { withColumn } from './column-meta';
import { COL_DATETIME, COL_IP, COL_STATUS, COL_STATUS_SM } from './column-widths';
import { paginationSchema, stringOrStringArray } from './common';

const notificationTypeEnum = z.enum([
  NOTIFICATION_TYPE.INFO,
  NOTIFICATION_TYPE.APPROVAL,
  NOTIFICATION_TYPE.WARNING,
  NOTIFICATION_TYPE.ERROR,
  NOTIFICATION_TYPE.SUCCESS,
  NOTIFICATION_TYPE.SALES_ACTION,
]);

// 注：Notification 与 OperationLog 是只读实体（append-only）。
// 通知/操作日志均由后端服务内部产生，前端/CLI 不暴露 create——
// 历史上这里曾导出 createNotificationSchema / createOperationLogSchema，
// 仅 system.ts 内部使用，无任何调用方，反而让 CLI registry 误判为
// "三件组缺 update" 而把整个实体静默 drop（2026-05-10 修复）。

// ============================================================
// 操作日志查询
// ============================================================
export const queryOperationLogSchema = paginationSchema.extend({
  /** push 6: 字段从 userId 改为 employeeId */
  employeeId: z.string().uuid().optional(),
  module: stringOrStringArray,
  action: stringOrStringArray,
  /** 业务目标记录 ID，对应 operation_logs.target */
  target: z.string().optional(),
  /** details.kind，例如 change/request */
  kind: z.string().optional(),
  /** 按操作人模糊匹配（employee.username / employee.name） */
  operator: z.string().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
});

export type QueryOperationLogInput = z.infer<typeof queryOperationLogSchema>;

// ============================================================
// 登录日志查询
// ============================================================
export const queryLoginLogSchema = paginationSchema.extend({
  /** push 6: 字段从 userId 改为 employeeId */
  employeeId: z.string().uuid().optional(),
  username: z.string().optional(),
  actionType: stringOrStringArray,
  status: stringOrStringArray,
  startDate: z.string().optional(),
  endDate: z.string().optional(),
});

export type QueryLoginLogInput = z.infer<typeof queryLoginLogSchema>;

// ============================================================
// 系统配置查询
// ============================================================
export const querySystemConfigSchema = paginationSchema.extend({
  keyword: z.string().optional(),
  group: z.string().optional(),
  type: z.string().optional(),
});

export type QuerySystemConfigInput = z.infer<typeof querySystemConfigSchema>;

// ============================================================
// 更新系统参数（SystemParam）（含 version 用于乐观锁）
// ============================================================
export const updateSystemParamSchema = z.object({
  value: z.string().min(1, '参数值不能为空'),
  description: z.string().optional(),
  version: z.number().int().optional(),
});

export type UpdateSystemParamInput = z.infer<typeof updateSystemParamSchema>;

// ============================================================
// 通知查询
// ============================================================
export const queryNotificationSchema = paginationSchema.extend({
  userId: z.string().uuid().optional(),
  type: stringOrStringArray,
  isRead: z
    .preprocess((val) => {
      if (val === 'true') return true;
      if (val === 'false') return false;
      return val;
    }, z.boolean())
    .optional(),
});

export type QueryNotificationInput = z.infer<typeof queryNotificationSchema>;

// ============================================================
// 会话管理
// ============================================================
export const createSessionSchema = z.object({
  /** push 6: 单写 employeeId（user 表已删，sessions.employeeId NOT NULL） */
  employeeId: z.string().uuid('无效的员工ID'),
  deviceType: z.string().min(1, '设备类型不能为空'),
  deviceName: z.string().min(1, '设备名称不能为空'),
  browser: z.string().min(1, '浏览器不能为空'),
  os: z.string().min(1, '操作系统不能为空'),
  ipAddress: z.string().min(1, 'IP地址不能为空'),
  location: z.string().optional(),
  refreshToken: z.string().min(1, 'Refresh Token不能为空'),
  expiresAt: z.date(),
});

export type CreateSessionInput = z.infer<typeof createSessionSchema>;

export const querySessionSchema = paginationSchema.extend({
  userId: z.string().uuid().optional(),
  deviceType: z.string().optional(),
  ipAddress: z.string().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  isCurrent: z.boolean().optional(),
});

export type QuerySessionInput = z.infer<typeof querySessionSchema>;

// ============================================================
// 会话响应
// ============================================================
export const sessionResponseSchema = z.object({
  id: z.string().min(1, '会话ID不能为空'),
  userId: z.string().uuid('无效的用户ID'),
  deviceType: z.string().min(1, '设备类型不能为空'), // DB 存储为 String，运行时校验
  deviceName: z.string().min(1, '设备名称不能为空'),
  browser: z.string().min(1, '浏览器不能为空'),
  os: z.string().min(1, '操作系统不能为空'),
  ipAddress: z.string().min(1, 'IP地址不能为空'),
  location: z.string().nullable(),
  loginTime: z.date(),
  lastActiveTime: z.date(),
  isCurrent: z.boolean(),
});

export type SessionResponse = z.infer<typeof sessionResponseSchema>;

// ============================================================
// 操作日志响应
// ============================================================
export const operationLogResponseSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid().optional(),
  userName: z.string().optional(),
  module: withColumn(z.string(), {
    label: '模块',
    width: 120,
    type: 'custom', // moduleLabels 映射
  }),
  action: z.string(),
  target: z.string().optional(),
  content: z.string(),
  details: z.record(z.unknown()).optional().nullable(),
  ipAddress: z.string().optional(),
  createdAt: withColumn(z.string(), {
    label: '操作时间',
    width: COL_DATETIME,
    type: 'custom', // toLocaleString
  }),
  // 别名字段
  operationType: withColumn(z.string().optional(), {
    label: '操作类型',
    width: COL_STATUS,
    type: 'custom', // 圆角 badge + operationTypeColors
  }),
  operationDesc: withColumn(z.string().optional(), {
    label: '操作描述',
    minWidth: 240,
    type: 'custom', // 截断 + title tooltip
  }),
  operator: withColumn(z.string().optional(), {
    label: '操作人',
    width: COL_STATUS,
    type: 'custom', // font-medium
  }),
  operatorName: z.string().optional(),
  operatorUsername: z.string().optional(),
  operatorId: z.string().optional(),
  operatorIp: withColumn(z.string().optional(), {
    label: 'IP地址',
    width: COL_IP,
    type: 'custom', // muted
  }),
  targetId: z.string().optional(),
  targetName: z.string().optional(),
  beforeData: z.record(z.unknown()).optional(),
  afterData: z.record(z.unknown()).optional(),
});

export type OperationLogResponse = z.infer<typeof operationLogResponseSchema>;

// ============================================================
// 系统参数响应
// ============================================================
export const systemParamResponseSchema = z.object({
  id: z.string().uuid(),
  code: z.string(),
  name: z.string(),
  value: z.string(),
  type: z.string(),
  group: z.string(),
  description: z.string().optional(),
  // 审计
  createdAt: z.string().optional(),
  createdBy: z.string().optional().nullable(),
  updatedAt: z.string().optional(),
  updatedBy: z.string().optional().nullable(),
  deletedAt: z.string().optional().nullable(),
  version: z.number().optional(),
});

export type SystemParamResponse = z.infer<typeof systemParamResponseSchema>;

// ============================================================
// 通知响应
// ============================================================
export const notificationResponseSchema = z.object({
  id: z.string(),
  userId: z.string(),
  title: withColumn(z.string(), {
    label: '标题',
    minWidth: 180,
    type: 'custom', // 加粗 + 已读灰化
    required: true,
  }),
  content: withColumn(z.string(), {
    label: '内容',
    minWidth: 240,
    type: 'custom', // 截断 + 已读灰化
  }),
  type: withColumn(notificationTypeEnum, {
    label: '类型',
    width: COL_STATUS,
    type: 'custom', // 图标 + 颜色（typeConfig）
  }),
  link: z.string().optional().nullable(),
  isRead: withColumn(z.boolean(), {
    label: '状态',
    width: COL_STATUS_SM,
    type: 'custom', // 已读/未读 圆角 badge
  }),
  readAt: withColumn(z.string().optional().nullable(), {
    label: '已读时间',
    minWidth: 160,
    type: 'custom', // muted + toLocaleString
  }),
  // 审计
  createdAt: z.string().optional(),
  createdBy: z.string().optional().nullable(),
  updatedAt: z.string().optional(),
  updatedBy: z.string().optional().nullable(),
  deletedAt: z.string().optional().nullable(),
  version: z.number().optional(),
});

export type NotificationResponseOutput = z.infer<typeof notificationResponseSchema>;

// ============================================================
// 登录日志响应
// ============================================================
export const loginLogResponseSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  username: withColumn(z.string(), {
    label: '账号',
    width: 120,
    type: 'custom', // font-medium
    required: true,
  }),
  employeeName: withColumn(z.string().optional(), {
    label: '姓名',
    width: 120,
    type: 'custom', // font-medium
  }),
  actionType: withColumn(z.enum(['login', 'logout']), {
    label: '操作',
    width: COL_STATUS,
    type: 'custom', // 登录/登出 + 图标 + actionTypeStyles
  }),
  ip: withColumn(z.string(), {
    label: 'IP地址',
    width: COL_IP,
    type: 'text',
  }),
  userAgent: withColumn(z.string().optional(), {
    label: '浏览器/设备',
    minWidth: 200,
    type: 'custom', // muted + 40 字截断
  }),
  location: withColumn(z.string().optional(), {
    label: '位置/设备',
    minWidth: 140,
    type: 'custom', // muted
  }),
  status: withColumn(z.enum(['success', 'failed']), {
    label: '状态',
    width: COL_STATUS_SM,
    type: 'custom', // 成功/失败 + statusStyles
  }),
  failReason: withColumn(z.string().optional(), {
    label: '失败原因',
    minWidth: 180,
    type: 'custom', // 红字
  }),
  createdAt: withColumn(z.string(), {
    label: '时间',
    width: COL_DATETIME,
    type: 'custom', // toLocaleString
  }),
});

export type LoginLogResponse = z.infer<typeof loginLogResponseSchema>;

// 系统参数分组列表响应（GET /system-params 分组形态）
export const systemParamGroupedListResponseSchema = z.object({
  items: z.array(systemParamResponseSchema),
  grouped: z.record(z.array(systemParamResponseSchema)),
  total: z.number(),
});

export type SystemParamGroupedListResponseOutput = z.infer<
  typeof systemParamGroupedListResponseSchema
>;
