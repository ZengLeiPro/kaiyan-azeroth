import type { DecimalInput, DecimalNumber, UserStatus } from './common';

/**
 * 员工基础信息（用于下拉框选择）
 */
export interface EmployeeForSelection {
  id: string;
  name: string;
  serialNumber: string;
}

/**
 * 员工完整信息
 */
export interface IEmployee extends EmployeeForSelection {
  phone?: string | null;
  email?: string | null;
  gender?: string | null;
  position?: string | null;
  /** 工时单价（元/小时） @precision Decimal */
  hourlyRate?: DecimalNumber | null;
  status: string;
  entryDate?: string | null;
  avatar?: string | null;
  // 登录账号字段（password 等敏感字段禁止出现在响应类型中）
  username?: string | null;
  loginStatus?: UserStatus;
  canLogin?: boolean;
  lastLoginAt?: string | null;
  lastLoginIp?: string | null;
  loginFailCount?: number;
  lockUntil?: string | null;
  tokenInvalidAfter?: string | null;
  // 钉钉同步字段
  dingtalkUserId?: string | null;
  dingtalkUnionId?: string | null;
  jobNumber?: string | null;
  workPlace?: string | null;
  isAdmin?: boolean;
  isBoss?: boolean;
  isLeader?: boolean;
  dingtalkActive?: boolean;
  dingtalkExtension?: Record<string, unknown> | null;
  lastSyncAt?: string | null;
  // 审计
  createdAt?: string;
  createdBy?: string | null;
  updatedAt?: string;
  updatedBy?: string | null;
  deletedAt?: string | null;
  version?: number;
}

/**
 * 员工所属部门信息
 */
export interface IEmployeeDepartmentInfo {
  id: string;
  departmentId: string;
  departmentName: string;
  isPrimary: boolean;
}

/**
 * 创建员工接口契约
 */
export interface ICreateEmployee {
  name: string;
  phone?: string | null;
  email?: string | null;
  gender?: string | null;
  entryDate?: string | null;
  position?: string | null;
  status?: string;
  avatar?: string | null;
  /** 工时单价（元/小时） @precision Decimal */
  hourlyRate?: DecimalInput | null;
  departmentIds?: string[];
  primaryDepartmentId?: string | null;
}

/**
 * 更新员工接口契约
 */
export type IUpdateEmployee = Partial<ICreateEmployee>;

/**
 * 员工 API 响应类型
 */
export interface IEmployeeResponse extends IEmployee {
  departments?: IEmployeeDepartmentInfo[];
  primaryDepartment?: IEmployeeDepartmentInfo | null;
}

/**
 * 员工列表项类型
 */
export type IEmployeeListItem = IEmployeeResponse;
