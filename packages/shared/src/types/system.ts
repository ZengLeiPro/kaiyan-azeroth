import type { NotificationTypeValue } from '../constants/notification';

export interface ISession {
  id: string;
  userId: string;
  /** 设备类型：desktop/mobile/tablet */
  deviceType: string;
  /** 设备名称 */
  deviceName: string;
  /** 浏览器信息 */
  browser: string;
  /** 操作系统信息 */
  os: string;
  /** 登录 IP 地址 */
  ipAddress: string;
  /** 地理位置 */
  location?: string | null;
  /** 刷新令牌（部分字段名可能与后端有差异，以前端使用为准） */
  refreshToken: string;
  /** 过期时间 */
  expiresAt: string | Date;
  /** 登录时间 */
  loginTime?: string | Date;
  /** 最后活跃时间 */
  lastActiveTime?: string | Date;
  /** 是否为当前会话 */
  isCurrent?: boolean;
  createdAt?: string | Date;
}

export interface ICreateSession {
  userId: string;
  deviceType: string;
  deviceName: string;
  browser: string;
  os: string;
  ipAddress: string;
  location?: string;
  refreshToken: string;
  expiresAt: Date;
}

/**
 * 个人访问令牌（Personal Access Token）
 *
 * 给第三方系统（如 agent 平台）以特定用户身份调用 API 用的长期凭证。
 * 走完整 RBAC 链路：tokenHash 命中后注入对应 user 身份。
 */
export interface IPersonalAccessToken {
  id: string;
  userId: string;
  /** 用途描述，例如 "agent-ops-bot" */
  name: string;
  /** SHA-256(token) 的 hex；明文 token 仅在签发时返回一次 */
  tokenHash: string;
  /** token 前缀（pat_<username>_前 8 位 hex），仅供管理界面识别 */
  prefix: string;
  /** 最近一次使用时间 */
  lastUsedAt?: string | Date | null;
  /** 最近一次使用 IP */
  lastUsedIp?: string | null;
  /** 过期时间（null = 不过期） */
  expiresAt?: string | Date | null;
  /** 吊销时间（null = 有效，软删除） */
  revokedAt?: string | Date | null;
  createdAt: string | Date;
  createdBy?: string | null;
}

export interface IOperationLog {
  id: string;
  userId?: string;
  userName?: string;
  module: string;
  action: string;
  target?: string;
  content: string;
  details?: IOperationLogDetailsPayload | Record<string, unknown> | null;
  ipAddress?: string;
  createdAt: string;
}

export interface INotification {
  id: string;
  userId: string;
  title: string;
  content: string;
  type: NotificationTypeValue;
  link?: string | null;
  isRead: boolean;
  readAt?: string | null;
  // 审计
  createdAt?: string;
  createdBy?: string | null;
  updatedAt?: string;
  updatedBy?: string | null;
  deletedAt?: string | null;
  version?: number;
}

/** Notification API 响应类型别名（与其他模块保持一致的命名规范） */
export type INotificationResponse = INotification;

export interface ICreateNotification {
  userId: string;
  title: string;
  content: string;
  type?: NotificationTypeValue;
}

export interface ICreateOperationLog {
  userId: string;
  userName?: string;
  module: string;
  action: string;
  target?: string;
  content: string;
  details?: IOperationLogDetailsPayload | Record<string, unknown> | null;
  ipAddress?: string;
}

/**
 * 操作日志变更数据
 *
 * 由于操作日志需要记录不同模块（产品、订单、用户等）的变更数据，
 * 每个模块的数据结构都不同，因此使用 `Record<string, unknown>` 是合理的设计。
 *
 * 常见的数据结构示例：
 * - 产品变更: { name: "xxx", price: 100, ... }
 * - 订单变更: { status: "pending", items: [...], ... }
 * - 用户变更: { username: "xxx", roles: [...], ... }
 *
 * 后端存储在 OperationLog.details 的 before/after 字段中
 */
export type OperationLogChangeData = Record<string, unknown>;

/**
 * 操作日志详情结构（存储在数据库 details 字段）
 */
export interface IOperationLogDetailsPayload {
  /** 变更前的数据快照 */
  before?: OperationLogChangeData;
  /** 变更后的数据快照 */
  after?: OperationLogChangeData;
  /** 额外的元数据 */
  [key: string]: unknown;
}

/**
 * 操作日志 API 响应（包含后端映射的字段别名）
 */
export interface IOperationLogResponse extends IOperationLog {
  /** 操作类型（别名，映射自 action） */
  operationType?: string;
  /** 操作描述（别名，映射自 target 或 action） */
  operationDesc?: string;
  /** 操作人（优先 employee.name，兜底 employee.username） */
  operator?: string;
  /** 操作人姓名（映射自 employee.name） */
  operatorName?: string;
  /** 操作人账号（映射自 employee.username，部分账号为手机号） */
  operatorUsername?: string;
  /** 操作人ID（别名，映射自 employeeId/userId） */
  operatorId?: string;
  /** 操作人IP（别名，映射自 ipAddress） */
  operatorIp?: string;
  /** 目标ID */
  targetId?: string;
  /** 目标名称 */
  targetName?: string;
  /** 变更前数据（从 details.before 提取） */
  beforeData?: OperationLogChangeData;
  /** 变更后数据（从 details.after 提取） */
  afterData?: OperationLogChangeData;
}

// ============================================================================
// SystemParam 类型定义（对应 Prisma SystemConfig 模型）
// ============================================================================

/** 系统参数类型 */
export type SystemParamType = 'string' | 'number' | 'boolean' | 'json';

/**
 * 系统参数实体接口
 * 对应 Prisma 的 SystemConfig 模型
 */
export interface ISystemParam {
  id: string;
  /** 参数编码（唯一标识） */
  code: string;
  /** 参数名称 */
  name: string;
  /** 参数值 */
  value: string;
  /** 参数类型：string | number | boolean | json */
  type: string;
  /** 参数分组 */
  group: string;
  /** 参数描述 */
  description?: string;
  // 审计
  createdAt?: string;
  createdBy?: string | null;
  updatedAt?: string;
  updatedBy?: string | null;
  deletedAt?: string | null;
  version?: number;
}

/**
 * 系统参数 API 响应接口
 */

export interface ISystemParamResponse extends ISystemParam {}

/**
 * 系统参数输入接口
 */
export interface IUpdateSystemParam {
  /** 参数值 */
  value: string;
  /** 参数描述 */
  description?: string;
}

/**
 * 流水号计数器 (Prisma Model: SerialNumberCounter)
 */
export interface ISerialNumberCounter {
  id: string;
  /** 编号类型，如 PRODUCT, PURCHASE_ORDER */
  type: string;
  /** 日期键，格式 YYMMDD，档案类为 null */
  dateKey?: string | null;
  /** 当前计数值 */
  counter: number;
  createdAt: string;
  updatedAt: string;
}

// ============================================================================
// LoginLog 类型定义
// ============================================================================

/**
 * 登录日志
 */
export interface ILoginLog {
  id: string;
  userId: string;
  username: string;
  /** 员工姓名（由 employeeId 关联 employee.name，历史无关联记录为空） */
  employeeName?: string;
  /** 登录/登出 */
  actionType: 'login' | 'logout';
  /** IP 地址 */
  ip: string;
  /** 用户代理 */
  userAgent?: string;
  /** 位置 */
  location?: string;
  /** 状态 */
  status: 'success' | 'failed';
  /** 失败原因 */
  failReason?: string;
  createdAt: string;
}

/**
 * 登录日志响应
 */

export interface ILoginLogResponse extends ILoginLog {}
