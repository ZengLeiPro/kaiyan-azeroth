/**
 * BSS / CMS API 响应的应用层 DTO（去除 SDK 包装、统一类型）。
 */

export interface AccountBalanceInfo {
  currency: string;
  /** 可用余额（元） */
  availableAmount: number;
  /** 可用现金（元） */
  availableCashAmount: number;
  /** 信用额度（元） */
  creditAmount: number;
}

export interface ProductBillRow {
  productCode: string;
  productName: string;
  subscriptionType: string;
  /** 应付金额（资源包抵扣后） */
  pretaxAmount: number;
  /** 原价 */
  pretaxGrossAmount: number;
  /** 实付金额 */
  paymentAmount: number;
}

export interface InstanceBillRow {
  instanceId: string;
  productCode: string;
  productName: string;
  subscriptionType: string;
  billingType: string | null;
  billingItemCode: string | null;
  pretaxAmount: number;
  pretaxGrossAmount: number;
  /** 资源包未覆盖、进入按量计费的用量 */
  usage: number;
  /** 被资源包抵扣的用量 */
  deductedByResourcePackage: number;
  usageUnit: string | null;
  region: string | null;
  nickName: string | null;
  /** 服务到期周期（Subscription 类才有） */
  servicePeriod: string | null;
  /** 该实例计费日期（DAILY 才有；MONTHLY 一般为空） */
  billingDate: string | null;
}

export interface ResourcePackageRow {
  instanceId: string;
  productCode: string;
  packageType: string | null;
  region: string | null;
  totalAmount: number;
  remainingAmount: number;
  unit: string | null;
  status: string | null;
  effectiveTime: string | null;
  expiryTime: string | null;
  applicableProducts: string[];
  remark: string | null;
}

export interface CmsDataPoint {
  /** 毫秒时间戳 */
  timestamp: number;
  /** FC 维度 */
  functionName?: string;
  serviceName?: string;
  region?: string;
  userId?: string;
  /** OSS 维度 */
  bucket?: string;
  /** 百炼维度 */
  modelId?: string;
  modelType?: string;
  /** 通用值字段（FC/OSS/Bailian 都是扁平 Value） */
  Value?: number;
  Average?: number;
  Sum?: number;
  Maximum?: number;
  Minimum?: number;
  [key: string]: unknown;
}
