import type { ViewScope } from '../constants/status-values';
import type { UserStatus } from './common';

/**
 * 用户信息
 */
export interface IUser {
  id: string;
  username: string;
  phone?: string | null;
  email?: string | null;
  avatar?: string | null;
  employeeId?: string | null;
  roles: IRole[];
  status: UserStatus;
  lastLoginAt?: string | null;
  lastLoginIp?: string | null;
  createdAt?: string;
  createdBy?: string | null;
  updatedAt?: string;
  updatedBy?: string | null;
  deletedAt?: string | null;
  version?: number;
}

/**
 * Legacy alias for IUser
 */
export type User = IUser;

/**
 * 创建用户接口契约
 */
export interface ICreateUser {
  username: string;
  phone?: string | null;
  email?: string | null;
  password: string;
  avatar?: string | null;
  // 必填：push 6 起登录身份必须挂在 employee 上，与 createUserSchema 对齐（IUpdateUser 经 Partial 自动转可选）。
  employeeId: string;
  roleIds: string[];
}

/**
 * 更新用户接口契约
 */
export type IUpdateUser = Partial<ICreateUser> & {
  status?: string;
  version?: number;
};

/**
 * 角色
 */
export interface IRole {
  id: string;
  code: string;
  name: string;
  description?: string | null;
  permissions: Permission[];
  userIds?: string[];
  status: 'active' | 'disabled';
  createdAt?: string;
  createdBy?: string | null;
  updatedAt?: string;
  updatedBy?: string | null;
  deletedAt?: string | null;
  version?: number;
}

/**
 * Legacy alias for IRole
 */
export type Role = IRole;

/**
 * 创建角色接口契约
 */
export interface ICreateRole {
  name: string;
  code: string;
  description?: string;
  permissions: Permission[];
  userIds?: string[];
}

/**
 * 更新角色接口契约
 */
export type IUpdateRole = Partial<ICreateRole> & {
  status?: string;
};

/**
 * 权限
 */
export interface Permission {
  module: string;
  menu: string;
  view: boolean;
  create: boolean;
  edit: boolean;
  delete: boolean;
  export: boolean;
  approve: boolean;
  /** 数据范围：SELF=仅本人，ALL=全部 */
  viewScope: ViewScope;
}

/**
 * 权限动作 (Legacy - can be removed if unused)
 */
export interface PermissionAction {
  view: boolean;
  create: boolean;
  edit: boolean;
  delete: boolean;
  export: boolean;
  approve: boolean;
}

/**
 * 登录请求
 */
export interface LoginRequest {
  username: string;
  password: string;
  rememberMe?: boolean;
}

/**
 * 认证接口返回的完整用户声明。
 * login / refresh / me 必须由服务端实时计算，不能沿用客户端缓存的角色/权限声明。
 */
export interface AuthUser {
  id: string;
  username: string;
  phone?: string | null;
  email?: string | null;
  avatar?: string | null;
  status: string;
  roles: Array<Pick<IRole, 'id' | 'code' | 'name' | 'permissions'>>;
  employee?: {
    id: string;
    name: string;
  } | null;
}

/**
 * 登录响应
 */
export interface LoginResponse {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  user: AuthUser;
}

/**
 * 刷新令牌请求
 */
export interface RefreshTokenRequest {
  refreshToken: string;
}

/**
 * 刷新令牌响应
 */
export interface RefreshTokenResponse {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  user: AuthUser;
}

/**
 * JWT Payload
 */
export interface JwtPayload {
  sub: string;
  username: string;
  roles: string[];
  iat: number;
  exp: number;
}

/**
 * 用户 API 响应类型
 */
export interface IUserResponse extends IUser {
  employee?: {
    id: string;
    name: string;
  } | null;
}

/**
 * 角色 API 响应类型
 */

export interface IRoleResponse extends IRole {
  userCount?: number;
}

/**
 * 用户角色关联 (Prisma Model: UserRole)
 */
export interface IUserRole {
  userId: string;
  roleId: string;
  createdAt: string;
}

/**
 * 角色权限关联 (Prisma Model: RolePermission)
 */
export interface IRolePermission {
  id: string;
  roleId: string;
  module: string;
  menu: string;
  view: boolean;
  create: boolean;
  edit: boolean;
  delete: boolean;
  export: boolean;
  approve: boolean;
  /** 数据范围：SELF=仅本人，ALL=全部 */
  viewScope: ViewScope;
  createdAt: string;
}
