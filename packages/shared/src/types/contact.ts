/**
 * 联系人实体
 */
export interface IContact {
  id: string;
  contactName: string;
  customerId: string;
  sex: string | null;
  mobile: string | null;
  phone: string | null;
  email: string | null;
  wechat: string | null;
  position: string | null;
  department: string | null;
  remark: string | null;
  flowStatus: string | null;
  status: string;
  // 审计
  createdAt?: string;
  createdBy?: string | null;
  updatedAt?: string;
  updatedBy?: string | null;
  deletedAt?: string | null;
  version?: number;
}

/**
 * 联系人 API 响应类型
 */
export interface IContactResponse extends IContact {
  /** 关联客户信息 */
  customer?: IContactCustomerInfo;
}

/**
 * 联系人关联客户简要信息
 */
export interface IContactCustomerInfo {
  id: string;
  customerName: string;
  shortName: string | null;
}

/**
 * 联系人选择器选项（用于下拉框）
 */
export interface ContactForSelection {
  id: string;
  contactName: string;
  position?: string | null;
  phone?: string | null;
}

/**
 * 创建联系人接口契约
 */
export interface ICreateContact {
  contactName: string;
  customerId: string;
  sex?: string | null;
  mobile?: string | null;
  phone?: string | null;
  email?: string | null;
  wechat?: string | null;
  position?: string | null;
  department?: string | null;
  remark?: string | null;
}

/**
 * 更新联系人接口契约
 */
export type IUpdateContact = Partial<ICreateContact>;
