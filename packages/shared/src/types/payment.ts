import type { DecimalNumber } from './common';

/**
 * 回款 / 退款实体
 *
 * direction='IN'  → 回款（PAY-xxxxx）
 * direction='OUT' → 普通退款（REF-xxxxx）或只读的 YCCRM 历史负向调整
 *
 * 一旦审批通过，direction 字段冻结，update 接口禁止修改。
 */
export interface IPayment {
  id: string;
  serialNumber: string;
  /**
   * 业务摘要。IN→「首期款/进度款/尾款/...」OUT→「客户退款/...」
   * 实体显示名统一规约的派生主源；P2 阶段起 schema NOT NULL。
   */
  subject: string;
  saleOrderId: string;
  customerId: string;
  /** @precision Decimal */
  paymentAmount: DecimalNumber;
  paymentType: string | null;
  businessDate: string | null;
  bankName: string | null;
  tradeSerialNumber: string | null;
  chargerId: string | null;
  chargerName: string | null;
  remark: string | null;
  flowStatus: string | null;
  status: string;
  /** 资金流方向：IN=回款 / OUT=退款或历史负向调整 */
  direction: string;
  /** 是否为 YCCRM 历史负向调整；普通业务接口不可创建 */
  legacyAdjustment: boolean;
  /** 退款类型（普通 direction='OUT' 时必填） */
  refundType: string | null;
  /** 退款原因自由文本 */
  refundReason: string | null;
  /** 关联的原回款 ID（direction='OUT' 时必填） */
  relatedPaymentId: string | null;
  /** 关联的红字发票 ID（direction='OUT' 时可选） */
  relatedInvoiceId: string | null;
  /** 财务收款账户（绑定方案 v2.1） */
  financeAccountId?: string | null;
  /** 财务入账科目（绑定方案 v2.1，v2.2 后单一字段语义弱化，主用 PaymentItem.financeSubjectId） */
  financeSubjectId?: string | null;
  // 审计
  createdAt?: string;
  createdBy?: string | null;
  updatedAt?: string;
  updatedBy?: string | null;
  deletedAt?: string | null;
  version?: number;
}

/**
 * 回款子项（绑定方案 v2.2 新增）
 * 一笔 payment 拆 N 个 PaymentItem，每行 = 一个产品 × 金额 × 财务科目 × 收款模式
 * 同步钩子按 PaymentItem 派生 N 条 FinanceLedger（dingtalk_collect / pass_through_cost 跳过）
 */
export interface IPaymentItem {
  id: string;
  paymentId: string;
  /** 强引用 OrderProduct.id（v2.2 Phase 11 后 NOT NULL） */
  saleOrderProductId: string;
  /** 同 payment 下 item 序号（1-based） */
  itemSeq: number;
  /** 产品名快照 */
  productName: string;
  /** @precision Decimal */
  amount: DecimalNumber;
  financeSubjectId: string | null;
  /** direct / dingtalk_collect / pass_through / pass_through_cost */
  paymentMode: string;
  remark: string | null;
  // 审计
  createdAt?: string;
  creatorEmployeeId?: string | null;
  updatedAt?: string;
  updaterEmployeeId?: string | null;
  deletedAt?: string | null;
  version?: number;
}

/**
 * 回款关联客户简要信息
 */
export interface IPaymentCustomerInfo {
  id: string;
  customerName: string;
  shortName: string | null;
}

/**
 * 回款关联销售订单简要信息
 */
export interface IPaymentSaleOrderInfo {
  id: string;
  orderTitle: string | null;
  serialNumber: string;
}

/**
 * 关联的原回款简要信息（OUT 退款专用，用于展示「退的是哪笔」）
 */
export interface IPaymentRelatedPaymentInfo {
  id: string;
  serialNumber: string;
  /** @precision Decimal */
  paymentAmount: DecimalNumber;
  businessDate: string | null;
}

/**
 * 关联的红字发票简要信息（OUT 退款专用）
 */
export interface IPaymentRelatedInvoiceInfo {
  id: string;
  serialNumber: string;
  /** @precision Decimal */
  invoiceAmount: DecimalNumber;
  invoiceStatus: string | null;
}

/**
 * 回款 API 响应类型
 *
 * refundedAmount / refundableAmount 仅对 direction='IN' 行有意义：
 * - refundedAmount: 该笔 IN 已被多少 approved OUT 退掉的总额
 * - refundableAmount: paymentAmount - refundedAmount，前端按此过滤"可退余额>0"
 * OUT 行这两个字段始终为 null。
 */
export interface IPaymentResponse extends IPayment {
  customer?: IPaymentCustomerInfo;
  saleOrder?: IPaymentSaleOrderInfo;
  relatedPayment?: IPaymentRelatedPaymentInfo;
  relatedInvoice?: IPaymentRelatedInvoiceInfo;
  /** 当前 API 返回未软删 PaymentItem；optional 仅兼容旧缓存/测试对象。 */
  items?: IPaymentItem[];
  /** 已退总额（仅 IN 行）@precision Decimal */
  refundedAmount?: DecimalNumber | null;
  /** 剩余可退余额（仅 IN 行）@precision Decimal */
  refundableAmount?: DecimalNumber | null;
}

/**
 * PaymentItem 创建子契约（v2.2，随 payment 一起创建）
 */
export interface ICreatePaymentItemInput {
  saleOrderProductId: string;
  /** 有限正数 @precision Decimal */
  amount: DecimalNumber;
  /** direct / dingtalk_collect / pass_through（pass_through_cost 仅 admin） */
  paymentMode: string;
  financeSubjectId?: string | null;
  productName?: string | null;
  remark?: string | null;
}

/**
 * 创建回款接口契约（IN 方向，原 ICreatePayment 语义保留）
 */
export interface ICreatePayment {
  saleOrderId: string;
  /**
   * 可选兼容字段；后端会以 saleOrder.customerId 为准，并拒绝与订单客户不一致的值。
   */
  customerId?: string | null;
  /**
   * 业务摘要。必填，预设见 PAYMENT_SUBJECT_IN_PRESETS。
   */
  subject: string;
  /** 有限正数 @precision Decimal */
  paymentAmount: DecimalNumber;
  paymentType: string | null;
  businessDate: string | null;
  bankName: string | null;
  tradeSerialNumber?: string | null;
  chargerId: string | null;
  remark?: string | null;
  /**
   * 资金流方向。创建回款接口默认 IN；退款走独立的 ICreatePaymentRefund 契约。
   */
  direction?: string;
  /**
   * PaymentItem 子项数组（v2.2）
   *
   * 销售下单时把回款拆成 N 行（每行 → 一个 OrderProduct × amount × 模式 × 科目）。
   * 至少一行且每行金额必须为有限正数；后端校验 Σ items.amount === paymentAmount，
   * 通过后与 Payment 头表及反向缓存同事务提交。
   */
  items: ICreatePaymentItemInput[];
}

/**
 * 创建退款接口契约（OUT 方向专用，更严格的校验）
 */
export interface ICreatePaymentRefund {
  saleOrderId: string;
  customerId?: string | null;
  /**
   * 业务摘要。OUT 方向可选，不传时后端用 refundType 兜底（保持与 P0 阶段
   * getEntityDisplayName 退化逻辑一致）。预设见 PAYMENT_SUBJECT_OUT_PRESETS。
   */
  subject?: string;
  /** 有限正数 @precision Decimal */
  paymentAmount: DecimalNumber;
  paymentType: string | null;
  businessDate: string | null;
  bankName: string | null;
  tradeSerialNumber?: string | null;
  chargerId: string | null;
  remark?: string | null;
  /** 退款类型，必填 */
  refundType: string;
  /** 退款原因自由文本，可选 */
  refundReason?: string | null;
  /** 关联的原 IN 回款 ID，必填 */
  relatedPaymentId: string;
  /** 关联的红字发票 ID，可选（同步触发冲红时填入） */
  relatedInvoiceId?: string | null;
}

/**
 * 更新回款接口契约
 *
 * direction / refundType / relatedPaymentId 等不可逆字段不应在 update 中出现，
 * 但保留 Partial<ICreatePayment> 以兼容旧调用——后端会显式拒绝 direction 修改。
 */
export type IUpdatePayment = Partial<ICreatePayment>;
