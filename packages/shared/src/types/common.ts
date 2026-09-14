/**
 * 精度敏感的数值类型
 *
 * 这些字段在数据库中以 Decimal 类型存储，API 返回时转换为 JavaScript number。
 *
 * @precision 数据库存储精度为 Decimal(12,2) 或 Decimal(10,2)
 * @see Prisma schema 中的 Decimal 字段定义
 *
 * 前端使用注意事项：
 * 1. 避免直接进行算术运算（如 a + b），应使用后端计算的汇总字段
 * 2. 显示时建议使用 toFixed(2) 或 Intl.NumberFormat 格式化
 * 3. 如需前端计算，请使用 decimal.js 或 big.js 库
 * 4. 向 API 提交数据时，建议转换为 string（如 String(value)）以避免 JS 浮点数精度丢失
 */
export type DecimalNumber = number;
/**
 * 精度敏感的数值类型输入别名
 *
 * 用于 Create/Update 接口的输入参数。
 * 允许前端传递 string 以避免精度丢失，后端 DTO 会处理转换。
 */
export type DecimalInput = number | string;

/**
 * ISO 8601 日期时间字符串
 *
 * 后端返回格式：2024-01-21T08:30:00.000Z
 * 用于 createdAt、updatedAt 等时间戳字段
 */
export type ISODateTime = string;

/**
 * 纯日期字符串
 *
 * 格式：YYYY-MM-DD（如 2024-01-21）
 * 用于 entryDate 等仅需日期的字段
 */
export type DateString = string;

/**
 * 分页请求参数
 */
export interface PaginationParams {
  page?: number;
  pageSize?: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

/**
 * 分页响应（与 createPaginatedResponseSchema 保持一致的扁平结构）
 */
export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

/**
 * 审批状态
 */
export type ApprovalStatus = 'draft' | 'pending' | 'approved' | 'rejected';

/**
 * 用户状态
 */
export type UserStatus = 'active' | 'disabled' | 'locked';

/**
 * 员工状态
 */
export type EmployeeStatus = 'active' | 'inactive' | 'resigned';

/**
 * 附件创建参数
 */
export interface IAttachmentCreate {
  /** 文件名 */
  name: string;
  /** 文件访问 URL */
  url: string;
  /** 文件大小（字节） */
  size: number;
  /** MIME 类型 */
  mimeType: string;
}

/**
 * 附件
 * 创建时 id 可选（由后端生成），读取时 id 必存在
 */
export interface IAttachment extends IAttachmentCreate {
  /** 附件唯一标识，用于前端列表渲染 key */
  id: string;
  /** 当前登录员工的短时下载地址；仅用于读取展示，不应持久化 */
  downloadUrl?: string;
}

/**
 * 附件 (Deprecated: Use IAttachment instead)
 */
export type Attachment = IAttachment;

/**
 * 基础审计字段
 */
export interface AuditFields {
  createdAt: Date;
  createdBy: string;
  updatedAt: Date;
  updatedBy: string;
  deletedAt?: Date;
  version: number;
}

/**
 * 操作日志详情结构
 */
export interface IOperationLogDetails {
  action: string;
  changes?: Record<string, { before: unknown; after: unknown }>;
  metadata?: Record<string, unknown>;
}
