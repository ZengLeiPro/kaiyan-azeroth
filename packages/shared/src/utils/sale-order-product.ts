export interface SaleOrderProductPricingInput {
  quantity: number | null | undefined;
  unitPrice: number | null | undefined;
  contractUnitPrice: number | null | undefined;
}

export interface SaleOrderProductPricingResult {
  discount: number | null;
  productAmount: number | null;
  subtotalAmount: number | null;
}

function isPositiveFiniteNumber(value: number | null | undefined): value is number {
  return value != null && Number.isFinite(value) && value > 0;
}

function roundToTwo(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * 订单产品折扣由「产品单价」与「合同单价」反推。
 * contractUnitPrice 是最终成交单价，小计不再二次套用折扣。
 */
export function calculateSaleOrderProductPricing(
  input: SaleOrderProductPricingInput
): SaleOrderProductPricingResult {
  const { quantity, unitPrice, contractUnitPrice } = input;
  const discount =
    isPositiveFiniteNumber(unitPrice) && isPositiveFiniteNumber(contractUnitPrice)
      ? roundToTwo((1 - contractUnitPrice / unitPrice) * 100)
      : null;
  const subtotalAmount =
    isPositiveFiniteNumber(quantity) && isPositiveFiniteNumber(contractUnitPrice)
      ? roundToTwo(quantity * contractUnitPrice)
      : null;
  const productAmount =
    isPositiveFiniteNumber(quantity) && isPositiveFiniteNumber(unitPrice)
      ? roundToTwo(quantity * unitPrice)
      : null;

  return { discount, productAmount, subtotalAmount };
}

/**
 * 订单里的产品单价是成本价，合同单价是成交价。
 * 复用历史 discount 字段保存差异比例，但展示时区分加价与折扣，避免出现负折扣。
 */
export function formatSaleOrderPriceAdjustment(
  discount: number | string | null | undefined
): string {
  if (discount == null) return '-';
  const value = Number(discount);
  if (!Number.isFinite(value)) return '-';
  if (value < 0) return `加价 ${Math.abs(value).toFixed(2)}%`;
  if (value > 0) return `折扣 ${value.toFixed(2)}%`;
  return '无浮动';
}

export function calculateOpportunityFinalUnitPrice(input: {
  quantity: number | null | undefined;
  unitPrice: number | null | undefined;
  discount: number | null | undefined;
  subtotalAmount: number | null | undefined;
}): number | null {
  const { quantity, unitPrice, discount, subtotalAmount } = input;
  if (isPositiveFiniteNumber(quantity) && isPositiveFiniteNumber(subtotalAmount)) {
    return roundToTwo(subtotalAmount / quantity);
  }
  if (!isPositiveFiniteNumber(unitPrice)) return null;
  const discountValue = discount ?? 0;
  if (!Number.isFinite(discountValue)) return null;
  return roundToTwo(unitPrice * (1 - discountValue / 100));
}
