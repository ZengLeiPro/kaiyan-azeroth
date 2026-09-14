import { createSaleOrderSchema } from '@ky-azeroth/shared/schemas/sale-order';
import type {
  IOpportunityProductInfo,
  IOpportunityResponse,
} from '@ky-azeroth/shared/types/opportunity';
import type {
  ICreateOrderProduct,
  ICreateSaleOrder,
  IOrderProductInfo,
  ISaleOrderResponse,
} from '@ky-azeroth/shared/types/sale-order';
import {
  calculateOpportunityFinalUnitPrice,
  calculateSaleOrderProductPricing,
  formatDateString,
  toAPIDateString,
} from '@ky-azeroth/shared/utils';

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface SaleOrderProfile extends ISaleOrderResponse {}

/**
 * 前端产品明细行表单数据
 * 增加 tempId 用于 React key 和行操作标识
 *
 * 表单编辑态允许数值字段暂为空；提交时由 shared schema 校验必填且大于 0。
 */
export interface OrderProductFormItem extends Omit<
  ICreateOrderProduct,
  'quantity' | 'unitPrice' | 'contractUnitPrice' | 'subtotalAmount'
> {
  tempId: string;
  /** @precision Decimal */
  quantity: number | null;
  /** @precision Decimal */
  unitPrice: number | null;
  /** @precision Decimal */
  contractUnitPrice: number | null;
  /** @precision Decimal */
  subtotalAmount: number | null;
}

/**
 * 销售订单表单态数据
 *
 * 这些字段在表单态允许为空（用户尚未填写），由 createSaleOrderSchema 在提交时校验必填：
 * - opportunityId / chargerId（string | null）
 * - orderAmount / otherFee（DecimalNumber 但允许 null）
 * - businessDate / paymentDate / orderBeginDate（string | null）
 */
export interface SaleOrderFormData extends Omit<
  ICreateSaleOrder,
  | 'products'
  | 'opportunityId'
  | 'orderAmount'
  | 'otherFee'
  | 'badDebtAmount'
  | 'businessDate'
  | 'orderBeginDate'
  | 'chargerId'
> {
  version?: number;
  opportunityId: string | null;
  /** @precision Decimal */
  orderAmount: number | null;
  /** @precision Decimal */
  otherFee: number | null;
  /** 坏账金额：从未收余额中核销 @precision Decimal */
  badDebtAmount: number | null;
  businessDate: string | null;
  orderBeginDate: string | null;
  chargerId: string | null;
  products: OrderProductFormItem[];
  productsTouched?: boolean;
}

export const saleOrderFormSchema = createSaleOrderSchema;

export function toSaleOrderProfile(data: ISaleOrderResponse): SaleOrderProfile {
  return {
    ...data,
    businessDate: normalizeDateOnly(data.businessDate),
    paymentDate: normalizeDateOnly(data.paymentDate),
    orderBeginDate: normalizeDateOnly(data.orderBeginDate),
    orderEndDate: normalizeDateOnly(data.orderEndDate),
  };
}

function normalizeDateOnly(value: string | null | undefined): string | null {
  const formatted = formatDateString(value);
  return formatted || null;
}

/**
 * IOrderProductInfo (API 响应) -> OrderProductFormItem (表单)
 */
function toProductFormItem(product: IOrderProductInfo): OrderProductFormItem {
  return {
    tempId: product.id,
    productName: product.productName,
    productNumber: product.productNumber ?? null,
    productPrice: product.productPrice != null ? Number(product.productPrice) : null, // @decimal-ignore: 读取转 Number
    unitPrice: product.unitPrice != null ? Number(product.unitPrice) : null, // @decimal-ignore: 读取转 Number
    contractUnitPrice: product.contractUnitPrice != null ? Number(product.contractUnitPrice) : null, // @decimal-ignore: 读取转 Number
    quantity: product.quantity != null ? Number(product.quantity) : 1, // @decimal-ignore: 读取转 Number
    discount: product.discount != null ? Number(product.discount) : null, // @decimal-ignore: 读取转 Number
    subtotalAmount: product.subtotalAmount != null ? Number(product.subtotalAmount) : null, // @decimal-ignore: 读取转 Number
    remark: product.remark ?? null,
  };
}

function calculateProductSubtotal(input: {
  quantity: number | null;
  contractUnitPrice: number | null;
}): number | null {
  return calculateSaleOrderProductPricing({
    quantity: input.quantity,
    unitPrice: null,
    contractUnitPrice: input.contractUnitPrice,
  }).subtotalAmount;
}

/**
 * 商机产品明细 -> 合同订单产品明细表单行。
 *
 * OpportunityProduct 和 OrderProduct 都是快照明细，字段口径一致，但前端行需要 tempId。
 */
function toOrderProductFormItemFromOpportunityProduct(
  product: IOpportunityProductInfo
): OrderProductFormItem {
  const quantity = product.quantity != null ? Number(product.quantity) : 1;
  const unitPrice = product.unitPrice != null ? Number(product.unitPrice) : null;
  const legacyDiscount = product.discount != null ? Number(product.discount) : 0;
  const legacySubtotalAmount =
    product.subtotalAmount != null ? Number(product.subtotalAmount) : null;
  const contractUnitPrice = calculateOpportunityFinalUnitPrice({
    quantity,
    unitPrice,
    discount: legacyDiscount,
    subtotalAmount: legacySubtotalAmount,
  });
  const derived = calculateSaleOrderProductPricing({ quantity, unitPrice, contractUnitPrice });
  const discount = derived.discount ?? legacyDiscount;
  const subtotalAmount =
    derived.subtotalAmount ?? calculateProductSubtotal({ quantity, contractUnitPrice });

  return {
    tempId: crypto.randomUUID(),
    productName: product.productName,
    productNumber: product.productNumber ?? null,
    productPrice: product.productPrice != null ? Number(product.productPrice) : null, // @decimal-ignore: 读取转 Number
    unitPrice, // @decimal-ignore: 读取转 Number
    contractUnitPrice, // @decimal-ignore: 读取转 Number
    quantity, // @decimal-ignore: 读取转 Number
    discount, // @decimal-ignore: 读取转 Number
    subtotalAmount, // @decimal-ignore: 读取转 Number
    remark: product.remark ?? null,
  };
}

/**
 * 创建空白产品行
 */
export function createEmptyOrderProductItem(): OrderProductFormItem {
  return {
    tempId: crypto.randomUUID(),
    productName: '',
    productNumber: null,
    productPrice: null,
    unitPrice: null,
    contractUnitPrice: null,
    quantity: 1,
    discount: 0,
    subtotalAmount: null,
    remark: null,
  };
}

export function updateOrderProductPricingField(
  row: OrderProductFormItem,
  field: 'unitPrice' | 'contractUnitPrice' | 'quantity',
  value: number | null
): OrderProductFormItem {
  const shouldSyncContractPrice =
    field === 'unitPrice' &&
    (row.contractUnitPrice == null || row.contractUnitPrice === row.unitPrice);
  const nextRow = {
    ...row,
    [field]: value,
    ...(shouldSyncContractPrice ? { contractUnitPrice: value } : {}),
  };
  const derived = calculateSaleOrderProductPricing(nextRow);

  return {
    ...nextRow,
    discount: derived.discount,
    subtotalAmount: derived.subtotalAmount,
  };
}

export function applyProductSelectionToOrderProduct(
  row: OrderProductFormItem,
  selection: {
    productName: string;
    productNumber: string | null;
    standardPrice: number | null;
  }
): OrderProductFormItem {
  const hasEnteredPrice = row.unitPrice != null || row.contractUnitPrice != null;
  const nextRow = {
    ...row,
    productName: selection.productName,
    productNumber: selection.productNumber,
    productPrice: selection.standardPrice,
    unitPrice: hasEnteredPrice ? row.unitPrice : selection.standardPrice,
    contractUnitPrice: hasEnteredPrice ? row.contractUnitPrice : selection.standardPrice,
  };
  const derived = calculateSaleOrderProductPricing(nextRow);

  return {
    ...nextRow,
    discount: derived.discount,
    subtotalAmount: derived.subtotalAmount,
  };
}

export function toSaleOrderFormData(entity: SaleOrderProfile): SaleOrderFormData {
  return {
    orderTitle: entity.orderTitle ?? null,
    customerId: entity.customerId,
    opportunityId: entity.opportunityId ?? null,
    orderAmount: entity.orderAmount != null ? Number(entity.orderAmount) : null,
    otherFee: entity.otherFee != null ? Number(entity.otherFee) : null,
    badDebtAmount: entity.badDebtAmount != null ? Number(entity.badDebtAmount) : 0,
    // orderStatus 由后端派生（5 态），表单不携带 / 不提交；详情展示读 SaleOrderProfile.orderStatus
    businessDate: normalizeDateOnly(entity.businessDate),
    paymentDate: normalizeDateOnly(entity.paymentDate),
    orderBeginDate: normalizeDateOnly(entity.orderBeginDate),
    orderEndDate: normalizeDateOnly(entity.orderEndDate),
    chargerId: entity.chargerId ?? null,
    remark: entity.remark ?? null,
    version: entity.version,
    products: entity.products?.map((p) => toProductFormItem(p)) ?? [],
    productsTouched: false,
  };
}

/**
 * 关联商机后自动带出合同创建表单字段。
 *
 * 仅映射商机作为事实来源的字段：客户、商机金额、产品明细。
 * 负责人保持当前表单值，避免覆盖“当前登录人”默认值或用户手动选择。
 */
export function applyOpportunityToSaleOrderFormData(
  form: SaleOrderFormData,
  opportunity: IOpportunityResponse
): SaleOrderFormData {
  const products =
    opportunity.products?.map((product) => toOrderProductFormItemFromOpportunityProduct(product)) ??
    [];

  return {
    ...form,
    customerId: opportunity.customerId,
    opportunityId: opportunity.id,
    orderAmount:
      opportunity.opportunityAmount != null ? Number(opportunity.opportunityAmount) : null,
    products: products.length > 0 ? products : [createEmptyOrderProductItem()],
    productsTouched: true,
  };
}

/**
 * 表单数据 -> API 提交 payload
 * Decimal 字段使用 String() 提交以避免 JS 浮点精度丢失
 */
export function toSaleOrderPayload(form: SaleOrderFormData) {
  return {
    orderTitle: form.orderTitle?.trim() || null,
    customerId: form.customerId,
    opportunityId: form.opportunityId || null,
    orderAmount: form.orderAmount != null ? String(form.orderAmount) : null,
    otherFee: form.otherFee != null ? String(form.otherFee) : null,
    badDebtAmount: form.badDebtAmount != null ? String(form.badDebtAmount) : null,
    // orderStatus 后端派生，前端 payload 不再携带（CLAUDE.md: 状态机由 service 维护）
    businessDate: toAPIDateString(form.businessDate),
    paymentDate: toAPIDateString(form.paymentDate),
    orderBeginDate: toAPIDateString(form.orderBeginDate),
    orderEndDate: toAPIDateString(form.orderEndDate),
    chargerId: form.chargerId || null,
    remark: form.remark?.trim() || null,
    version: form.version,
    products:
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      form.products.map(({ tempId, ...p }) => ({
        productName: p.productName.trim(),
        productNumber: p.productNumber?.trim() || null,
        productPrice: p.productPrice != null ? String(p.productPrice) : null,
        unitPrice: p.unitPrice != null ? String(p.unitPrice) : null,
        contractUnitPrice: p.contractUnitPrice != null ? String(p.contractUnitPrice) : null,
        quantity: p.quantity != null ? String(p.quantity) : null,
        discount: p.discount != null ? String(p.discount) : null,
        subtotalAmount: p.subtotalAmount != null ? String(p.subtotalAmount) : null,
        remark: p.remark?.trim() || null,
      })),
  };
}

export function toSaleOrderUpdatePayload(form: SaleOrderFormData) {
  const payload = toSaleOrderPayload(form);
  if (form.productsTouched) return payload;

  const { products, ...payloadWithoutProducts } = payload;
  void products;
  return payloadWithoutProducts;
}
