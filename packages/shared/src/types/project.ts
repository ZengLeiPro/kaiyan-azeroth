/**
 * 项目实体
 */
export interface IProject {
  id: string;
  name: string;
  description?: string | null;
  status: string;
  logicalStatus?: string | null;
  category?: string | null;
  customerId?: string | null;
  customerName?: string | null;
  opportunityId?: string | null;
  opportunityName?: string | null;
  saleOrderId?: string | null;
  orderTitle?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  ownerId?: string | null;
  ownerName?: string | null;
  createdAt?: string;
  createdBy?: string | null;
  updatedAt?: string;
  updatedBy?: string | null;
  deletedAt?: string | null;
  version?: number;
}

/**
 * 项目成员实体
 */
export interface IProjectMember {
  id: string;
  projectId: string;
  employeeId?: string | null;
  userName?: string | null;
  email?: string | null;
  role?: string | null;
  isActive?: boolean;
  joinedAt?: string | null;
  createdAt?: string;
  createdBy?: string | null;
  updatedAt?: string;
  updatedBy?: string | null;
  deletedAt?: string | null;
  version?: number;
}

/**
 * 项目成员 API 响应类型
 */
export interface IProjectMemberResponse extends Omit<IProjectMember, 'version'> {
  version: number;
}

/**
 * 创建项目成员接口契约
 */
export interface ICreateProjectMember {
  employeeId: string;
  userName?: string | null;
  role?: string | null;
}

/**
 * 更新项目成员接口契约
 */
export type IUpdateProjectMember = Partial<ICreateProjectMember>;

/**
 * 项目 API 响应类型
 */
/**
 * 项目-合同订单关联实体
 */
export interface IProjectSaleOrder {
  id: string;
  projectId: string;
  saleOrderId: string;
  remark?: string | null;
  createdAt?: string;
  createdBy?: string | null;
}

/**
 * 项目关联订单简要信息（含订单冗余字段，用于展示）
 */
export interface IProjectSaleOrderLink extends IProjectSaleOrder {
  orderTitle?: string | null;
  orderAmount?: number | null;
}

export interface IProjectResponse extends Omit<IProject, 'version'> {
  version: number;
  members?: IProjectMemberResponse[];
  saleOrders?: IProjectSaleOrderLink[];
}

/**
 * 项目选择器 API 响应类型
 */
export interface IProjectSelectionOption {
  id: string;
  name: string;
  status: string;
  category: string | null;
  customerName: string | null;
}

/**
 * 创建项目接口契约
 */
export interface ICreateProject {
  name: string;
  description?: string | null;
  status?: string;
  logicalStatus?: string | null;
  category?: string | null;
  customerId?: string | null;
  opportunityId?: string | null;
  saleOrderId?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  ownerId?: string | null;
}

/**
 * 更新项目接口契约
 */
export type IUpdateProject = Partial<ICreateProject> & { version: number };
