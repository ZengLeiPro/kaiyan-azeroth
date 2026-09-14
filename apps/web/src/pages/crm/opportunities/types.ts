import { createOpportunitySchema } from '@ky-azeroth/shared/schemas/opportunity';
import type { DecimalNumber } from '@ky-azeroth/shared/types';
import type {
  ICreateOpportunity,
  ICreateOpportunityProduct,
  IOpportunityProductInfo,
  IOpportunityResponse,
} from '@ky-azeroth/shared/types/opportunity';
import { formatDateString, toAPIDateString } from '@ky-azeroth/shared/utils';

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface OpportunityProfile extends IOpportunityResponse {}

/**
 * 前端产品明细行表单数据
 * 增加 tempId 用于 React key 和行操作标识
 */
export interface OpportunityProductFormItem extends Omit<
  ICreateOpportunityProduct,
  'quantity' | 'unitPrice'
> {
  tempId: string;
  /** @precision Decimal */
  quantity: number | null;
  /** @precision Decimal */
  unitPrice: number | null;
}

/**
 * 表单中间态允许 stage/amount/chargerId 暂时为空，提交时由 createOpportunitySchema 强制校验。
 * realDealDate 不进入表单（在前端 UI 隐藏；后端在阶段=赢单时自动填值）。
 * lostDate 进入表单（仅 stage=输单流失 时显示，参考 expectedDealDate 的 string|null 形态）。
 */
export interface OpportunityFormData extends Omit<
  ICreateOpportunity,
  | 'opportunityStage'
  | 'opportunityAmount'
  | 'chargerId'
  | 'expectedDealDate'
  | 'products'
  | 'realDealDate'
> {
  opportunityStage: string | null;
  opportunityAmount: DecimalNumber | null;
  chargerId: string | null;
  expectedDealDate: string | null;
  products: OpportunityProductFormItem[];
  version?: number;
  productsTouched?: boolean;
}

/**
 * 表单校验：在 shared createOpportunitySchema 基础上加联动 refine——
 *  1) stage=输单流失 时强制要求失单原因非空
 *  2) 失单原因='其他' 时强制要求 loseReasonDetail 非空
 *
 * 联动 refine 写在前端层（不在 shared），避免污染 nestjs-zod 的 ZodObject.shape OpenAPI 反射。
 * 后端 service 的 assertLostReasonOnLost / assertLoseReasonDetailOnOther 做权威兜底。
 */
export const opportunityFormSchema = createOpportunitySchema
  .refine(
    (data) => {
      if (data.opportunityStage !== '输单流失') return true;
      const reason = data.loseReason;
      return typeof reason === 'string' && reason.trim().length > 0;
    },
    {
      message: '商机阶段为「输单流失」时必须填写失单原因',
      path: ['loseReason'],
    }
  )
  .refine(
    (data) => {
      if (data.loseReason !== '其他') return true;
      const detail = data.loseReasonDetail;
      return typeof detail === 'string' && detail.trim().length > 0;
    },
    {
      message: '失单原因选择「其他」时必须填写备注说明',
      path: ['loseReasonDetail'],
    }
  );

export function toOpportunityProfile(data: IOpportunityResponse): OpportunityProfile {
  return {
    ...data,
    expectedDealDate: normalizeDateOnly(data.expectedDealDate),
    realDealDate: normalizeDateOnly(data.realDealDate),
  };
}

function normalizeDateOnly(value: string | null | undefined): string | null {
  const formatted = formatDateString(value);
  return formatted || null;
}

/**
 * IOpportunityProductInfo (API 响应) -> OpportunityProductFormItem (表单)
 */
function toProductFormItem(product: IOpportunityProductInfo): OpportunityProductFormItem {
  return {
    tempId: product.id,
    productName: product.productName,
    productNumber: product.productNumber ?? null,
    productPrice: product.productPrice != null ? Number(product.productPrice) : null, // @decimal-ignore: 读取转 Number
    quantity: product.quantity != null ? Number(product.quantity) : 1, // @decimal-ignore: 读取转 Number
    unitPrice: product.unitPrice != null ? Number(product.unitPrice) : null, // @decimal-ignore: 读取转 Number
    discount: product.discount != null ? Number(product.discount) : null, // @decimal-ignore: 读取转 Number
    subtotalAmount: product.subtotalAmount != null ? Number(product.subtotalAmount) : null, // @decimal-ignore: 读取转 Number
    remark: product.remark ?? null,
  };
}

/**
 * 创建空白产品行
 */
export function createEmptyProductItem(): OpportunityProductFormItem {
  return {
    tempId: crypto.randomUUID(),
    productName: '',
    productNumber: null,
    productPrice: null,
    quantity: 1,
    unitPrice: null,
    discount: null,
    subtotalAmount: null,
    remark: null,
  };
}

export function toOpportunityFormData(entity: OpportunityProfile): OpportunityFormData {
  return {
    opportunityName: entity.opportunityName ?? '',
    customerId: entity.customerId,
    contactId: entity.contactId ?? null,
    opportunityStage: entity.opportunityStage ?? null,
    opportunityAmount: entity.opportunityAmount != null ? Number(entity.opportunityAmount) : null,
    winRate: entity.winRate != null ? Number(entity.winRate) : null,
    expectedDealDate: normalizeDateOnly(entity.expectedDealDate),
    lostDate: normalizeDateOnly(entity.lostDate),
    chargerId: entity.chargerId ?? null,
    loseReason: entity.loseReason ?? null,
    loseReasonDetail: entity.loseReasonDetail ?? null,
    remark: entity.remark ?? null,
    version: entity.version,
    products: entity.products?.map((p) => toProductFormItem(p)) ?? [],
    productsTouched: false,
  };
}

/**
 * 表单数据 -> API 提交 payload
 * Decimal 字段使用 String() 提交以避免 JS 浮点精度丢失
 *
 * realDealDate 不再由前端表单传递：商机阶段=赢单 时由后端 service 自动填当前时间。
 */
export function toOpportunityPayload(form: OpportunityFormData) {
  const productSubtotalTotal =
    form.products && form.products.length > 0
      ? Math.round(
          form.products.reduce((sum, product) => sum + Number(product.subtotalAmount ?? 0), 0) * 100
        ) / 100
      : null;

  return {
    opportunityName: form.opportunityName?.trim() || null,
    customerId: form.customerId,
    contactId: form.contactId || null,
    opportunityStage: form.opportunityStage || null,
    opportunityAmount:
      productSubtotalTotal != null
        ? String(productSubtotalTotal)
        : form.opportunityAmount != null
          ? String(form.opportunityAmount)
          : null,
    winRate: form.winRate != null ? String(form.winRate) : null,
    expectedDealDate: toAPIDateString(form.expectedDealDate),
    lostDate: toAPIDateString(form.lostDate),
    chargerId: form.chargerId || null,
    loseReason: form.loseReason?.trim() || null,
    // loseReason ≠ '其他' 时强制清空 detail，避免脏数据残留（后端有同样兜底）
    loseReasonDetail: form.loseReason === '其他' ? form.loseReasonDetail?.trim() || null : null,
    remark: form.remark?.trim() || null,
    version: form.version,
    products:
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      form.products?.map(({ tempId, ...p }) => ({
        productName: p.productName.trim(),
        productNumber: p.productNumber?.trim() || null,
        productPrice: p.productPrice != null ? String(p.productPrice) : null,
        quantity: p.quantity != null ? String(p.quantity) : null,
        unitPrice: p.unitPrice != null ? String(p.unitPrice) : null,
        discount: p.discount != null ? String(p.discount) : null,
        subtotalAmount: p.subtotalAmount != null ? String(p.subtotalAmount) : null,
        remark: p.remark?.trim() || null,
      })) ?? [],
  };
}

export function toOpportunityUpdatePayload(form: OpportunityFormData) {
  const payload = toOpportunityPayload(form);
  if (form.productsTouched) return payload;

  const { products, ...payloadWithoutProducts } = payload;
  void products;
  return payloadWithoutProducts;
}
