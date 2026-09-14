import type { DecimalNumber } from './common';

/**
 * 商机实体
 */
export interface IOpportunity {
  id: string;
  serialNumber: string;
  opportunityName: string;
  customerId: string;
  contactId: string | null;
  opportunityStage: string | null;
  /** @precision Decimal */
  opportunityAmount: DecimalNumber | null;
  /** @precision Decimal */
  winRate: DecimalNumber | null;
  expectedDealDate: string | null;
  realDealDate: string | null;
  /** 输单流失日期。stage 切到「输单流失」且原值为空时由后端自动填当前时间。 */
  lostDate: string | null;
  chargerId: string | null;
  chargerName: string | null;
  chargerAvatar: string | null;
  loseReason: string | null;
  /** 失单原因备注（仅当 loseReason='其他' 时使用，承载自由文本说明） */
  loseReasonDetail: string | null;
  /** WON 来源；历史 NULL 按未知/人工语义保守保留。 */
  wonSourceType: 'manual' | 'sale_order' | null;
  wonSourceSaleOrderId: string | null;
  wonSourcePreviousStage: string | null;
  wonSourcePreviousDealDate: string | null;
  /** @precision Decimal */
  wonSourcePreviousWinRate: DecimalNumber | null;
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
 * 商机产品实体（对应 Prisma OpportunityProduct 模型）
 */
export interface IOpportunityProduct {
  id: string;
  opportunityId: string;
  productName: string;
  productNumber: string | null;
  /** @precision Decimal */
  productPrice: DecimalNumber | null;
  /** @precision Decimal */
  quantity: DecimalNumber | null;
  /** @precision Decimal */
  unitPrice: DecimalNumber | null;
  /** @precision Decimal */
  discount: DecimalNumber | null;
  /** @precision Decimal */
  subtotalAmount: DecimalNumber | null;
  remark: string | null;
  flowStatus: string | null;
  // 审计
  createdAt?: string;
  createdBy?: string | null;
  updatedAt?: string;
  updatedBy?: string | null;
  deletedAt?: string | null;
  version?: number;
}

/**
 * 商机产品明细（API 响应用，省略关联外键）
 */
export interface IOpportunityProductInfo {
  id: string;
  productName: string;
  productNumber: string | null;
  /** @precision Decimal */
  productPrice: DecimalNumber | null;
  /** @precision Decimal */
  quantity: DecimalNumber | null;
  /** @precision Decimal */
  unitPrice: DecimalNumber | null;
  /** @precision Decimal */
  discount: DecimalNumber | null;
  /** @precision Decimal */
  subtotalAmount: DecimalNumber | null;
  remark: string | null;
}

/**
 * 商机关联联系人简要信息
 */
export interface IOpportunityContactInfo {
  id: string;
  contactName: string;
}

/**
 * 商机 API 响应类型
 */
export interface IOpportunityResponse extends IOpportunity {
  /** 关联客户信息 */
  customer?: IOpportunityCustomerInfo;
  /** 关联联系人信息 */
  contact?: IOpportunityContactInfo;
  /** 商机产品明细列表 */
  products?: IOpportunityProductInfo[];
}

/**
 * 商机关联客户简要信息
 */
export interface IOpportunityCustomerInfo {
  id: string;
  customerName: string;
  shortName: string | null;
}

/**
 * 商机选择器选项（用于下拉框）
 */
export interface OpportunityForSelection {
  id: string;
  serialNumber: string;
  opportunityName: string;
  customerName?: string;
  /** @precision Decimal */
  opportunityAmount?: DecimalNumber | null;
  opportunityStage?: string | null;
  /** 商机下挂的产品名称列表，按 createdAt 顺序，用于选择器二级标签展示 */
  productNames?: string[];
}

/**
 * 创建商机产品明细契约（无 id，用于表单提交）
 */
export interface ICreateOpportunityProduct {
  productName: string;
  productNumber?: string | null;
  /** @precision Decimal */
  productPrice?: DecimalNumber | null;
  /** @precision Decimal */
  quantity: DecimalNumber;
  /** @precision Decimal */
  unitPrice: DecimalNumber;
  /** @precision Decimal */
  discount?: DecimalNumber | null;
  /** @precision Decimal */
  subtotalAmount?: DecimalNumber | null;
  remark?: string | null;
}

/**
 * 创建商机接口契约
 */
export interface ICreateOpportunity {
  /** 可为空，后端 service 在 create 时若为空会按 `客户名 - 创建日期 - 金额` 自动生成 */
  opportunityName?: string | null;
  customerId: string;
  contactId?: string | null;
  opportunityStage: string;
  /** @precision Decimal */
  opportunityAmount: DecimalNumber;
  /** @precision Decimal */
  winRate?: DecimalNumber | null;
  expectedDealDate: string;
  realDealDate?: string | null;
  /** 输单流失日期（仅当 stage='输单流失' 时有意义；为空时由后端自动填当前时间） */
  lostDate?: string | null;
  chargerId: string;
  loseReason?: string | null;
  /** 失单原因备注（仅当 loseReason='其他' 时使用） */
  loseReasonDetail?: string | null;
  remark?: string | null;
  /** 产品明细行：至少 1 项 */
  products: ICreateOpportunityProduct[];
}

/**
 * 更新商机接口契约
 */
export type IUpdateOpportunity = Partial<ICreateOpportunity> & { version: number };
