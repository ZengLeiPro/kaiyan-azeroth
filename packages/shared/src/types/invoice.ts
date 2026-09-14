import type { DecimalNumber } from './common';

/**
 * 开票实体
 */
export interface IInvoice {
  id: string;
  serialNumber: string;
  /**
   * 开票业务摘要，「软件开发服务费/技术服务费/钉钉软件费/...」
   * 实体显示名统一规约的派生主源；P2 阶段起 schema NOT NULL。
   * 注意区别 `title` 字段——那是"发票抬头"（客户公司名）。
   */
  subject: string;
  saleOrderId: string;
  customerId: string;
  /** @precision Decimal */
  invoiceAmount: DecimalNumber;
  invoiceType: string | null;
  invoiceDate: string | null;
  invoiceNumber: string | null;
  title: string | null;
  taxIdentifyNum: string | null;
  invoiceStatus: string | null;
  itemType: string | null;
  bankName: string | null;
  bankAccount: string | null;
  registeredAddress: string | null;
  registeredPhone: string | null;
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
 * 开票关联客户简要信息
 */
export interface IInvoiceCustomerInfo {
  id: string;
  customerName: string;
  shortName: string | null;
}

/**
 * 开票关联销售订单简要信息
 */
export interface IInvoiceSaleOrderInfo {
  id: string;
  serialNumber: string;
  /** 关联订单负责人名称 */
  chargerName?: string | null;
}

/**
 * 开票 API 响应类型
 */
export interface IInvoiceResponse extends IInvoice {
  customer?: IInvoiceCustomerInfo;
  saleOrder?: IInvoiceSaleOrderInfo;
  /** 派生负责人：优先取关联订单负责人，其次取客户负责人 */
  chargerName?: string | null;
}

/**
 * 创建开票接口契约
 */
export interface ICreateInvoice {
  saleOrderId: string;
  /**
   * 可选兼容字段；后端会以 saleOrder.customerId 为准，并拒绝与订单客户不一致的值。
   */
  customerId?: string | null;
  /**
   * 开票业务摘要。必填，预设见 INVOICE_SUBJECT_PRESETS。
   */
  subject: string;
  /** @precision Decimal */
  invoiceAmount: DecimalNumber;
  invoiceType: string;
  invoiceDate: string;
  invoiceNumber?: string | null;
  title?: string | null;
  taxIdentifyNum?: string | null;
  invoiceStatus?: string | null;
  itemType?: string | null;
  bankName?: string | null;
  bankAccount?: string | null;
  registeredAddress?: string | null;
  registeredPhone?: string | null;
  remark?: string | null;
}

/**
 * 更新开票接口契约
 */
export type IUpdateInvoice = Partial<ICreateInvoice>;
