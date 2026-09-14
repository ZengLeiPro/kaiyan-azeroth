import type { DecimalNumber } from './common';

/**
 * 合同订单实体
 */
export interface ISaleOrder {
  id: string;
  serialNumber: string;
  orderTitle: string | null;
  customerId: string;
  opportunityId: string | null;
  /** @precision Decimal */
  orderAmount: DecimalNumber | null;
  /** 其他相关费用（YCCRM 历史字段 sale_order_amount_0） @precision Decimal */
  otherFee: DecimalNumber | null;
  /** 坏账金额：核销未收余额，不计入实际回款 @precision Decimal */
  badDebtAmount: DecimalNumber;
  /** @precision Decimal */
  productAmount: DecimalNumber | null;
  /** @precision Decimal */
  totalReceivables: DecimalNumber | null;
  /** @precision Decimal */
  totalReceived: DecimalNumber | null;
  /** 已退款总额（OUT 方向、approved 且 legacyAdjustment=false 的 Payment SUM） @precision Decimal */
  totalRefunded: DecimalNumber;
  /** @precision Decimal */
  totalUncollected: DecimalNumber | null;
  /** 已开票金额：sum(invoice.invoiceAmount) where flowStatus='approved' AND status='active' @precision Decimal */
  invoicedAmount: DecimalNumber;
  /** 订单开票状态：未开票 / 部分开票 / 已开完（与 Invoice.invoiceStatus 的"正常/作废"是不同维度） */
  orderInvoiceStatus: string | null;
  /**
   * 订单状态（由 payment-summary.helper 派生）：
   *   未回款 / 部分回款 / 全额回款 / 部分退款 / 全额退款 / 历史冲正
   * 前端表单不应提交此字段——后端会忽略外部传入值。
   */
  orderStatus: string | null;
  /** 历史负向订单标识；仅由受控治理写入，前端不可编辑。 */
  legacyAdjustment: boolean;
  businessDate: string | null;
  paymentDate: string | null;
  /**
   * 最近回款日期：MAX(Payment.businessDate WHERE direction='IN' AND flowStatus='approved')。
   * 由 payment-summary.helper 派生维护（与 totalReceived 同口径），前端表单不应提交此字段。
   * 与手工录入的 paymentDate（回款时间）语义不同。
   */
  lastPaymentDate: string | null;
  orderBeginDate: string | null;
  orderEndDate: string | null;
  chargerId: string | null;
  chargerName: string | null;
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
 * 订单产品实体（对应 Prisma OrderProduct 模型）
 */
export interface IOrderProduct {
  id: string;
  saleOrderId: string;
  productName: string;
  productNumber: string | null;
  /** @precision Decimal */
  productPrice: DecimalNumber | null;
  /** @precision Decimal */
  quantity: DecimalNumber | null;
  /** @precision Decimal */
  unitPrice: DecimalNumber | null;
  /** @precision Decimal */
  contractUnitPrice: DecimalNumber | null;
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
 * 订单产品明细（API 响应用，省略关联外键）
 */
export interface IOrderProductInfo {
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
  contractUnitPrice: DecimalNumber | null;
  /** @precision Decimal */
  discount: DecimalNumber | null;
  /** @precision Decimal */
  subtotalAmount: DecimalNumber | null;
  remark: string | null;
}

/**
 * 合同订单 API 响应类型
 */
export interface ISaleOrderResponse extends ISaleOrder {
  /** 关联客户信息 */
  customer?: ISaleOrderCustomerInfo;
  /** 关联商机信息 */
  opportunity?: ISaleOrderOpportunityInfo;
  /** 订单产品明细列表 */
  products?: IOrderProductInfo[];
}

/**
 * 合同订单关联客户简要信息
 */
export interface ISaleOrderCustomerInfo {
  id: string;
  customerName: string;
  shortName: string | null;
}

/**
 * 合同订单关联商机简要信息
 */
export interface ISaleOrderOpportunityInfo {
  id: string;
  opportunityName: string;
  serialNumber: string;
}

/**
 * 创建订单产品明细契约（无 id，用于表单提交）
 */
export interface ICreateOrderProduct {
  productName: string;
  productNumber?: string | null;
  /** @precision Decimal */
  productPrice?: DecimalNumber | null;
  /** @precision Decimal */
  quantity: DecimalNumber;
  /** @precision Decimal */
  unitPrice: DecimalNumber;
  /** @precision Decimal */
  contractUnitPrice: DecimalNumber;
  /** @precision Decimal */
  discount?: DecimalNumber | null;
  /** @precision Decimal */
  subtotalAmount?: DecimalNumber | null;
  remark?: string | null;
}

/**
 * 创建合同订单接口契约
 *
 * 注意：以下字段都由后端派生/计算，创建/更新时禁止由前端传入：
 * - totalReceivables / totalReceived / totalRefunded / totalUncollected
 * - invoicedAmount / orderInvoiceStatus
 * - orderStatus（由 payment-summary.helper 派生，参见 ISaleOrder.orderStatus 注释）
 * - legacyAdjustment（仅由受控历史治理写入）
 */
export interface ICreateSaleOrder {
  orderTitle?: string | null;
  customerId: string;
  opportunityId: string;
  /** @precision Decimal */
  orderAmount: DecimalNumber;
  /** 其他相关费用 @precision Decimal */
  otherFee: DecimalNumber;
  /** 坏账金额：不传时后端默认 0 @precision Decimal */
  badDebtAmount?: DecimalNumber;
  businessDate: string;
  paymentDate?: string | null;
  orderBeginDate: string;
  orderEndDate?: string | null;
  chargerId: string;
  remark?: string | null;
  /** 产品明细行 */
  products: ICreateOrderProduct[];
}

/**
 * 更新合同订单接口契约
 */
export type IUpdateSaleOrder = Partial<ICreateSaleOrder>;

/**
 * 合同订单选择器展示类型（用于下拉框）
 */
export interface SaleOrderForSelection {
  id: string;
  serialNumber: string;
  orderName: string;
  customerId?: string;
  customerName?: string;
  opportunityId?: string | null;
  chargerId?: string | null;
  /** @precision Decimal */
  orderAmount?: DecimalNumber | null;
  /** @precision Decimal */
  totalReceived?: DecimalNumber | null;
  /** @precision Decimal */
  totalUncollected?: DecimalNumber | null;
  /** 订单回款状态：未回款 / 部分回款 / 全额回款 / 部分退款 / 全额退款 / 历史冲正 */
  orderStatus?: string | null;
  /** 历史负向订单标识。 */
  legacyAdjustment?: boolean;
  /** @precision Decimal */
  invoicedAmount?: DecimalNumber | null;
}
