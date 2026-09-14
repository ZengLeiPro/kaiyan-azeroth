/**
 * 云成本运维模块常量
 *
 * - vendor：云厂商（V1 仅 aliyun，预留多账号/多厂商扩展）
 * - productCode：跟随阿里云 BSS API 的 product_code 字段（小写英文）
 * - metricName：用量指标名（产品内唯一）
 * - alertLevel/category：预警分级与归类
 * - renewalIntent/ownerCategory：实例元数据手动维护字段
 */

// ==================== 云厂商 ====================

export const CLOUD_VENDOR = {
  ALIYUN: 'aliyun',
} as const;
export type CloudVendorValue = (typeof CLOUD_VENDOR)[keyof typeof CLOUD_VENDOR];
export const CLOUD_VENDOR_VALUES = Object.values(CLOUD_VENDOR) as [
  CloudVendorValue,
  ...CloudVendorValue[],
];

// ==================== 阿里云产品代码 ====================
/**
 * 阿里云 BSS API product_code 取值，全小写。
 * 新增产品仅需追加值，不要重命名（前端 statusMap 依赖）。
 */
export const CLOUD_PRODUCT_CODE = {
  FC: 'fc',
  OSS: 'oss',
  CDT: 'cdt',
  ECS: 'ecs',
  RDS: 'rds',
  KVSTORE: 'kvstore',
  VPC: 'vpc',
  CDN: 'cdn',
  DCDN: 'dcdn',
  SLS: 'sls',
  BAILIAN: 'bailian',
  SSL: 'cas',
  DOMAIN: 'dm',
  EIP: 'eip',
  NAT: 'nat',
} as const;
export type CloudProductCodeValue = (typeof CLOUD_PRODUCT_CODE)[keyof typeof CLOUD_PRODUCT_CODE];
export const CLOUD_PRODUCT_CODE_VALUES = Object.values(CLOUD_PRODUCT_CODE) as [
  CloudProductCodeValue,
  ...CloudProductCodeValue[],
];

// ==================== 预警等级 ====================

export const CLOUD_ALERT_LEVEL = {
  P0: 'p0',
  P1: 'p1',
  P2: 'p2',
} as const;
export type CloudAlertLevelValue = (typeof CLOUD_ALERT_LEVEL)[keyof typeof CLOUD_ALERT_LEVEL];
export const CLOUD_ALERT_LEVEL_VALUES = Object.values(CLOUD_ALERT_LEVEL) as [
  CloudAlertLevelValue,
  ...CloudAlertLevelValue[],
];

// ==================== 预警归类 ====================

export const CLOUD_ALERT_CATEGORY = {
  /** 账户余额不足 */
  BALANCE_LOW: 'balance_low',
  /** 资源包余量低 */
  PACKAGE_LOW: 'package_low',
  /** 资源包即将到期 */
  PACKAGE_EXPIRING: 'package_expiring',
  /** 订阅资源即将到期（包年 ECS / 域名 / SSL） */
  SUBSCRIPTION_EXPIRING: 'subscription_expiring',
  /** 当月扣费环比突增 */
  SPIKE_ANOMALY: 'spike_anomaly',
  /** 单项用量异常 */
  USAGE_ANOMALY: 'usage_anomaly',
  /** 资源包预测耗尽日早于到期日 */
  PACKAGE_RUNOUT_EARLY: 'package_runout_early',
} as const;
export type CloudAlertCategoryValue =
  (typeof CLOUD_ALERT_CATEGORY)[keyof typeof CLOUD_ALERT_CATEGORY];
export const CLOUD_ALERT_CATEGORY_VALUES = Object.values(CLOUD_ALERT_CATEGORY) as [
  CloudAlertCategoryValue,
  ...CloudAlertCategoryValue[],
];

// ==================== 预警状态 ====================

export const CLOUD_ALERT_STATUS = {
  ACTIVE: 'active',
  RESOLVED: 'resolved',
  DISMISSED: 'dismissed',
} as const;
export type CloudAlertStatusValue = (typeof CLOUD_ALERT_STATUS)[keyof typeof CLOUD_ALERT_STATUS];
export const CLOUD_ALERT_STATUS_VALUES = Object.values(CLOUD_ALERT_STATUS) as [
  CloudAlertStatusValue,
  ...CloudAlertStatusValue[],
];

// ==================== 续费意愿（实例元数据） ====================

export const CLOUD_RENEWAL_INTENT = {
  /** 已设置自动续费 */
  AUTO: 'auto',
  /** 手动续费，到期前评估 */
  MANUAL: 'manual',
  /** 到期不续 */
  CANCEL: 'cancel',
  /** 未决策 */
  UNDECIDED: 'undecided',
} as const;
export type CloudRenewalIntentValue =
  (typeof CLOUD_RENEWAL_INTENT)[keyof typeof CLOUD_RENEWAL_INTENT];
export const CLOUD_RENEWAL_INTENT_VALUES = Object.values(CLOUD_RENEWAL_INTENT) as [
  CloudRenewalIntentValue,
  ...CloudRenewalIntentValue[],
];

// ==================== 归属类别（实例元数据） ====================

export const CLOUD_OWNER_CATEGORY = {
  /** 内部基础设施（如 Agent 平台、Azeroth） */
  INTERNAL: 'internal',
  /** 客户专用（定制项目托管） */
  CUSTOMER: 'customer',
  /** 实验/临时（PoC、调试） */
  EXPERIMENTAL: 'experimental',
  /** 未标注 */
  UNKNOWN: 'unknown',
} as const;
export type CloudOwnerCategoryValue =
  (typeof CLOUD_OWNER_CATEGORY)[keyof typeof CLOUD_OWNER_CATEGORY];
export const CLOUD_OWNER_CATEGORY_VALUES = Object.values(CLOUD_OWNER_CATEGORY) as [
  CloudOwnerCategoryValue,
  ...CloudOwnerCategoryValue[],
];

// ==================== 用量指标名（按产品分类） ====================
/**
 * 命名规则：<产品>_<指标>，与 CMS API metric 含义对齐但用蛇形小写。
 */
export const CLOUD_METRIC_NAME = {
  // FC
  FC_CU_USAGE: 'fc_cu_usage',
  FC_INVOCATION: 'fc_invocation_count',
  FC_DURATION: 'fc_duration_ms',
  // OSS
  OSS_STORAGE_SIZE: 'oss_storage_size_bytes',
  OSS_TRAFFIC_OUT: 'oss_traffic_out_bytes',
  OSS_TRAFFIC_IN: 'oss_traffic_in_bytes',
  OSS_REQUEST_COUNT: 'oss_request_count',
  // CDT
  CDT_TRAFFIC_OUT: 'cdt_traffic_out_bytes',
  // ECS（自定义上报或控制台）
  ECS_TRAFFIC_OUT: 'ecs_traffic_out_bytes',
  // 百炼
  BAILIAN_TOKEN_INPUT: 'bailian_token_input',
  BAILIAN_TOKEN_OUTPUT: 'bailian_token_output',
  BAILIAN_CALL_COUNT: 'bailian_call_count',
  // SLS
  SLS_LOG_SIZE: 'sls_log_size_bytes',
} as const;
export type CloudMetricNameValue = (typeof CLOUD_METRIC_NAME)[keyof typeof CLOUD_METRIC_NAME];
export const CLOUD_METRIC_NAME_VALUES = Object.values(CLOUD_METRIC_NAME) as [
  CloudMetricNameValue,
  ...CloudMetricNameValue[],
];
