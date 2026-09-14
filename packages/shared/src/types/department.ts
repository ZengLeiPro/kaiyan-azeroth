/**
 * 部门状态
 */
export type DepartmentStatus = 'active' | 'inactive';

/**
 * 部门基础信息（用于选择器）
 */
export interface DepartmentForSelection {
  id: string;
  name: string;
  parentId?: string | null;
}

/**
 * 员工所属部门信息
 */
export interface IEmployeeDepartment {
  id: string;
  employeeId: string;
  departmentId: string;
  departmentName: string;
  isPrimary: boolean;
  sortOrder: number;
  createdAt: string;
  createdBy?: string | null;
}

/**
 * 部门完整信息
 */
export interface IDepartment extends DepartmentForSelection {
  sortOrder: number;
  status: DepartmentStatus;
  managerId?: string | null;
  // 钉钉同步字段
  dingtalkDeptId?: number | null;
  dingtalkParentId?: number | null;
  createDeptGroup?: boolean;
  autoAddUser?: boolean;
  lastSyncAt?: string | null;
  // 审计
  createdAt: string;
  updatedAt: string;
  version?: number;
}

/**
 * 部门树节点（含子节点和统计信息）
 */
export interface IDepartmentTreeNode extends IDepartment {
  children: IDepartmentTreeNode[];
  /** 负责人信息（关联 Employee） */
  manager?: IDepartmentManagerInfo | null;
  employeeCount?: number;
}

/**
 * 创建部门请求
 */
export interface ICreateDepartment {
  name: string;
  parentId?: string | null;
  sortOrder?: number;
  managerId?: string | null;
  status?: DepartmentStatus;
}

/**
 * 更新部门请求
 */
export type IUpdateDepartment = Partial<ICreateDepartment>;

/**
 * 部门负责人简要信息
 */
export interface IDepartmentManagerInfo {
  id: string;
  name: string;
}

/**
 * 部门响应（含关联信息）
 */
export interface IDepartmentResponse extends IDepartment {
  parent?: DepartmentForSelection | null;
  /** 负责人信息（关联 Employee） */
  manager?: IDepartmentManagerInfo | null;
  employeeCount?: number;
  childrenCount?: number;
}

/**
 * 部门列表项
 */
export type IDepartmentListItem = IDepartmentResponse;
