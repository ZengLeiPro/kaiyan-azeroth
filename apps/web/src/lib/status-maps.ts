/**
 * 业务状态 / 分类 → Badge 配色映射（单一来源）
 *
 * - 所有颜色只引用 `status-colors.ts` 的统一 token（带暗色适配），不再写裸 Tailwind class。
 * - 状态机字段（status/stage/审批）用忠实语义色；高基数分类字段（行业/来源/类型）用
 *   `createCategoricalMap` 按枚举顺序确定性分配色板。
 * - `ALL_STATUS_MAPS` 汇总全部 map，供 `column-renderers.tsx` 一次性接通 schema-driven 渲染，
 *   今后新增 map 在此登记即自动生效，无需再逐个注册。
 */
import {
  PROJECT_TICKET_PRIORITY_LABELS,
  PROJECT_TICKET_STATUS_LABELS,
  PROJECT_TICKET_TYPE_LABELS,
} from '@ky-azeroth/shared/constants/project-ticket-constants';
import {
  APPROVAL_INSTANCE_STATUS_LABELS,
  CLOUD_ALERT_CATEGORY_LABELS,
  CLOUD_ALERT_LEVEL_LABELS,
  CLOUD_ALERT_STATUS_LABELS,
  CLOUD_OWNER_CATEGORY_LABELS,
  CLOUD_RENEWAL_INTENT_LABELS,
  CONTACT_STATUS_LABELS,
  CUSTOMER_LEVEL_LABELS,
  CUSTOMER_RELATIONSHIP_LABELS,
  CUSTOMER_SOURCE_LABELS,
  CUSTOMER_TAG_LABELS,
  DEAL_STATUS_LABELS,
  DEPARTMENT_STATUS_LABELS,
  EMPLOYEE_STATUS_LABELS,
  GENDER_LABELS,
  HEADCOUNT_RANGE_LABELS,
  INDUSTRY_LABELS,
  INTENT_TEMPERATURE_LABELS,
  INVOICE_ITEM_TYPE_LABELS,
  INVOICE_STATUS_LABELS,
  INVOICE_TYPE_LABELS,
  KEEP_RECORD_STATUS_LABELS,
  LEAD_PROGRESS_STATUS_LABELS,
  LEAD_STAGE_LABELS,
  LEAD_VALIDITY_LABELS,
  OPPORTUNITY_STAGE_LABELS,
  ORDER_INVOICE_STATUS_LABELS,
  ORDER_STATUS_LABELS,
  PAYMENT_METHOD_LABELS,
  PAYMENT_STATUS_LABELS,
  PRODUCT_STATUS_LABELS,
  PRODUCT_TYPE_LABELS,
  PRODUCT_UNIT_LABELS,
  PROJECT_CATEGORY_LABELS,
  PROJECT_STATUS_LABELS,
  RECORD_STATUS_LABELS,
  SALES_ACTION_ITEM_CATEGORY_LABELS,
  SALES_ACTION_ITEM_CONFIDENCE_LABELS,
  SALES_ACTION_ITEM_DONE_TYPE_LABELS,
  SALES_ACTION_ITEM_STATUS_LABELS,
  USER_STATUS_LABELS,
  VISIT_STATUS_LABELS,
  VISIT_TYPE_LABELS,
  WORK_DAILY_REPORT_TYPE_LABELS,
  WORK_DAILY_STATUS_LABELS,
} from '@ky-azeroth/shared/constants/status-labels';
import {
  KEEP_RECORD_TYPE_OPTIONS,
  OPPORTUNITY_LOSE_REASON,
  PAYMENT_REFUND_TYPE,
} from '@ky-azeroth/shared/constants/status-values';

import { categoricalColor, FALLBACK_COLOR, STATUS_PALETTE } from './status-colors';

export type StatusMapEntry = { label: string; color: string };
export type StatusMap = Record<string, StatusMapEntry>;

/** 配色 token 短引用 */
const P = STATUS_PALETTE;

/**
 * 用「值→显示文本」labels + 「值→颜色 token」colorMap 构造 StatusMap。
 * colorMap 可只覆盖部分键，缺失项回落 FALLBACK_COLOR。
 */
function createStatusMap<T extends Record<string, string>>(
  labels: T,
  colorMap: Partial<Record<keyof T, string>>
): StatusMap {
  const result: StatusMap = {};
  for (const key of Object.keys(labels)) {
    const label = labels[key];
    if (label !== undefined) {
      result[key] = { label, color: colorMap[key as keyof T] || FALLBACK_COLOR };
    }
  }
  return result;
}

/**
 * 高基数分类字段配色：按 labels 枚举顺序确定性分配色板（每次结果稳定、相邻值区分）。
 */
function createCategoricalMap(labels: Record<string, string>): StatusMap {
  const result: StatusMap = {};
  Object.keys(labels).forEach((key, index) => {
    const label = labels[key];
    if (label !== undefined) {
      result[key] = { label, color: categoricalColor(index) };
    }
  });
  return result;
}

/** {value,label}[] → Record<value,label> */
function optionsToLabels(options: { value: string; label: string }[]): Record<string, string> {
  return Object.fromEntries(options.map((o) => [o.value, o.label]));
}

/** 「KEY→中文值」常量（值即字段存储值，也作为 label）→ Record<value,value> */
function valueLabels(constObj: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.values(constObj).map((v) => [v, v]));
}

// ==================== 审批 ====================

export const approvalStatusMap = createStatusMap(APPROVAL_INSTANCE_STATUS_LABELS, {
  pending: P.yellow,
  approved: P.green,
  rejected: P.red,
  withdrawn: P.gray,
});

// ==================== 通用 ====================

export const recordStatusMap = createStatusMap(RECORD_STATUS_LABELS, {
  active: P.green,
  inactive: P.gray,
});

// ==================== CRM ====================

export const contactStatusMap = createStatusMap(CONTACT_STATUS_LABELS, {
  未接触: P.gray,
  已电话: P.blue,
  已拜访: P.green,
  已线上沟通: P.amber,
});

export const dealStatusMap = createStatusMap(DEAL_STATUS_LABELS, {
  未赢单: P.gray,
  已赢单: P.green,
  多次赢单: P.blue,
});

export const leadStageMap = createStatusMap(LEAD_STAGE_LABELS, {
  MQL: P.blue,
  SQL: P.green,
});

export const leadProgressStatusMap = createStatusMap(LEAD_PROGRESS_STATUS_LABELS, {
  ACTIVE: P.blue,
  NO_SHOW: P.orange,
  PENDING_VISIT: P.yellow,
  VISITED: P.cyan,
  WON: P.green,
  LOST: P.red,
});

export const intentTemperatureMap = createStatusMap(INTENT_TEMPERATURE_LABELS, {
  UNJUDGED: P.gray,
  HIGH: P.red,
  MEDIUM: P.orange,
  LOW: P.blue,
  NONE: P.gray,
});

export const leadValidityMap = createStatusMap(LEAD_VALIDITY_LABELS, {
  VALID: P.green,
  INVALID: P.red,
});

export const customerLevelMap = createStatusMap(CUSTOMER_LEVEL_LABELS, {
  S: P.purple,
  A: P.blue,
  B: P.cyan,
  C: P.amber,
  D: P.gray,
});

/** 客户来源（高基数分类） */
export const customerSourceMap = createCategoricalMap(CUSTOMER_SOURCE_LABELS);

/** 客户关系（高基数分类） */
export const customerRelationshipMap = createCategoricalMap(CUSTOMER_RELATIONSHIP_LABELS);

/** 客户标签（多选，tagBadgeList 渲染） */
export const customerTagMap = createCategoricalMap(CUSTOMER_TAG_LABELS);

/** 行业（21 值高基数分类） */
export const industryMap = createCategoricalMap(INDUSTRY_LABELS);

/** 员工规模 */
export const headcountRangeMap = createCategoricalMap(HEADCOUNT_RANGE_LABELS);

export const opportunityStageMap = createStatusMap(OPPORTUNITY_STAGE_LABELS, {
  发现需求: P.gray,
  解决方案: P.cyan,
  商务谈判: P.amber,
  合同签约: P.orange,
  赢单: P.green,
  输单流失: P.red,
});

/** 商机失单原因（高基数分类） */
export const loseReasonMap = createCategoricalMap(valueLabels(OPPORTUNITY_LOSE_REASON));

export const orderStatusMap = createStatusMap(ORDER_STATUS_LABELS, {
  未回款: P.gray,
  部分回款: P.amber,
  全额回款: P.green,
  部分退款: P.orange,
  全额退款: P.red,
  历史冲正: P.purple,
});

export const orderInvoiceStatusMap = createStatusMap(ORDER_INVOICE_STATUS_LABELS, {
  未开票: P.gray,
  部分开票: P.amber,
  已开完: P.green,
});

export const paymentStatusMap = createStatusMap(PAYMENT_STATUS_LABELS, {
  pending: P.yellow,
  confirmed: P.green,
  cancelled: P.gray,
});

/** 回款 / 退款方向 */
export const paymentDirectionMap: StatusMap = {
  IN: { label: '回款', color: P.emerald },
  OUT: { label: '退款', color: P.orange },
};

/** 付款方式（高基数分类） */
export const paymentTypeMap = createCategoricalMap(PAYMENT_METHOD_LABELS);

/** 退款类型（高基数分类） */
export const refundTypeMap = createCategoricalMap(valueLabels(PAYMENT_REFUND_TYPE));

export const invoiceStatusMap = createStatusMap(INVOICE_STATUS_LABELS, {
  正常: P.green,
  作废: P.red,
  已冲红: P.rose,
});

/** 发票类型（分类） */
export const invoiceTypeMap = createCategoricalMap(INVOICE_TYPE_LABELS);

/** 开票项目类型（分类） */
export const invoiceItemTypeMap = createCategoricalMap(INVOICE_ITEM_TYPE_LABELS);

export const keepRecordStatusMap = createStatusMap(KEEP_RECORD_STATUS_LABELS, {
  初次建联: P.cyan,
  需求确认: P.yellow,
  方案推进: P.blue,
  促单: P.indigo,
  客户维护: P.green,
  售后跟进: P.purple,
});

/** 跟进类型（Web 表单英文枚举：phone/visit/...） */
export const keepRecordTypeMap = createCategoricalMap(optionsToLabels(KEEP_RECORD_TYPE_OPTIONS));

export const visitStatusMap = createStatusMap(VISIT_STATUS_LABELS, {
  拜访完成: P.green,
});

/** 拜访类型（分类） */
export const visitTypeMap = createCategoricalMap(VISIT_TYPE_LABELS);

export const workDailyStatusMap = createStatusMap(WORK_DAILY_STATUS_LABELS, {
  按时提交: P.green,
  迟交: P.red,
});

/** 工作日报报告类型（日报/周报/月报） */
export const reportTypeMap = createCategoricalMap(WORK_DAILY_REPORT_TYPE_LABELS);

// ==================== 销售数据闭环（待办/作战项） ====================

/**
 * 待办 category：进攻暖色 / 防御信息色（勘察 09 §1.8）。
 * 进攻：跟进到期 rose / 商机变冷 orange / 应收静默 amber / 客户失联 red。
 * 防御：硬缺口 orange / 软缺口 yellow / 数据矛盾 red / 补录确认 blue。
 */
export const salesActionItemCategoryMap = createStatusMap(SALES_ACTION_ITEM_CATEGORY_LABELS, {
  // 进攻
  FOLLOW_UP_DUE: P.rose,
  DEAL_COOLING: P.orange,
  PAYMENT_SILENT: P.amber,
  CUSTOMER_STALE: P.red,
  // 防御
  GAP_HARD: P.orange,
  GAP_SOFT: P.yellow,
  CONFLICT: P.red,
  FILL_CONFIRM: P.blue,
});

/** 待办置信度：高 red / 疑似 yellow */
export const salesActionItemConfidenceMap = createStatusMap(SALES_ACTION_ITEM_CONFIDENCE_LABELS, {
  HIGH: P.red,
  MEDIUM: P.yellow,
});

/** 待办状态机：待处理 yellow / 已采纳 green / 已办结 blue / 已忽略 gray / 已稍后 cyan / 已转交 purple / 自动失效 gray */
export const salesActionItemStatusMap = createStatusMap(SALES_ACTION_ITEM_STATUS_LABELS, {
  pending: P.yellow,
  adopted: P.green,
  done: P.blue,
  ignored: P.gray,
  snoozed: P.cyan,
  transferred: P.purple,
  auto_expired: P.gray,
});

/** 办结类型：跟进情况 teal / 推进 green / 暂搁 amber / 误报 gray / 其他 blue */
export const salesActionItemDoneTypeMap = createStatusMap(SALES_ACTION_ITEM_DONE_TYPE_LABELS, {
  follow_recorded: P.teal,
  progressed: P.green,
  shelved: P.amber,
  false_alarm: P.gray,
  other: P.blue,
});

// ==================== 项目管理 ====================

export const projectStatusMap = createStatusMap(PROJECT_STATUS_LABELS, {
  未开始: P.gray,
  进行中: P.green,
  已完成: P.blue,
  Demo: P.cyan,
  测试: P.yellow,
  运维: P.indigo,
  暂停: P.orange,
  流失: P.red,
});

export const projectCategoryMap = createStatusMap(PROJECT_CATEGORY_LABELS, {
  定制开发: P.blue,
  内部产品: P.purple,
  内部支持: P.gray,
  SaaS产品: P.cyan,
  技术服务: P.green,
});

/** 项目工单状态（收编自 TicketStatusBadge） */
export const ticketStatusMap = createStatusMap(PROJECT_TICKET_STATUS_LABELS, {
  PENDING: P.amber,
  IN_PROGRESS: P.blue,
  COMPLETED: P.green,
  CLOSED: P.gray,
  CANCELLED: P.gray,
});

/** 项目工单优先级（收编自 TicketStatusBadge） */
export const ticketPriorityMap = createStatusMap(PROJECT_TICKET_PRIORITY_LABELS, {
  HIGH: P.red,
  MEDIUM: P.amber,
  LOW: P.gray,
});

/** 项目工单类型（收编自 TicketStatusBadge） */
export const ticketTypeMap = createStatusMap(PROJECT_TICKET_TYPE_LABELS, {
  REQUIREMENT: P.sky,
  CHANGE: P.indigo,
  OPS: P.teal,
  BUG: P.rose,
  OTHER: P.gray,
});

// ==================== 产品 ====================

/** CRM 产品上下架状态（收编自页面本地 productStatusMap） */
export const productStatusMap = createStatusMap(PRODUCT_STATUS_LABELS, {
  on_sale: P.green,
  off_sale: P.gray,
});

/** 产品类型（分类） */
export const productTypeMap = createCategoricalMap(PRODUCT_TYPE_LABELS);

/** 产品单位（分类） */
export const productUnitMap = createCategoricalMap(PRODUCT_UNIT_LABELS);

// ==================== 组织架构 ====================

export const employeeStatusMap = createStatusMap(EMPLOYEE_STATUS_LABELS, {
  active: P.green,
  inactive: P.gray,
  resigned: P.red,
});

export const departmentStatusMap = createStatusMap(DEPARTMENT_STATUS_LABELS, {
  active: P.green,
  inactive: P.gray,
});

export const genderMap = createStatusMap(GENDER_LABELS, {
  男: P.blue,
  女: P.pink,
});

/** 用户/登录状态（收编自 UsersPage 内联 + EmployeesPage 本地 loginStatusMap） */
export const userStatusMap = createStatusMap(USER_STATUS_LABELS, {
  active: P.green,
  disabled: P.gray,
  locked: P.red,
});

/** 登录状态别名（员工页 loginStatus 与 user.status 同枚举） */
export const loginStatusMap = userStatusMap;

// ==================== 运维 / 云成本 ====================

export const cloudOwnerCategoryMap = createStatusMap(CLOUD_OWNER_CATEGORY_LABELS, {
  internal: P.blue,
  customer: P.green,
  experimental: P.amber,
  unknown: P.gray,
});

export const cloudRenewalIntentMap = createStatusMap(CLOUD_RENEWAL_INTENT_LABELS, {
  auto: P.green,
  manual: P.blue,
  cancel: P.red,
  undecided: P.gray,
});

export const cloudAlertLevelMap = createStatusMap(CLOUD_ALERT_LEVEL_LABELS, {
  p0: P.red,
  p1: P.amber,
  p2: P.gray,
});

export const cloudAlertCategoryMap = createStatusMap(CLOUD_ALERT_CATEGORY_LABELS, {
  balance_low: P.red,
  package_low: P.amber,
  package_expiring: P.amber,
  subscription_expiring: P.amber,
  spike_anomaly: P.orange,
  usage_anomaly: P.purple,
  package_runout_early: P.rose,
});

export const cloudAlertStatusMap = createStatusMap(CLOUD_ALERT_STATUS_LABELS, {
  active: P.red,
  resolved: P.green,
  dismissed: P.gray,
});

// ====================================================================
// 汇总注册表：statusMapKey → StatusMap（供 column-renderers 一次性接通）
// 新增 map 在此登记一行即可被 schema-driven 渲染识别。
// ====================================================================

export const ALL_STATUS_MAPS: Record<string, StatusMap> = {
  recordStatus: recordStatusMap,
  approvalStatus: approvalStatusMap,
  contactStatus: contactStatusMap,
  dealStatus: dealStatusMap,
  leadStage: leadStageMap,
  leadProgressStatus: leadProgressStatusMap,
  intentTemperature: intentTemperatureMap,
  leadValidity: leadValidityMap,
  customerLevel: customerLevelMap,
  customerSource: customerSourceMap,
  customerRelationship: customerRelationshipMap,
  customerTag: customerTagMap,
  industry: industryMap,
  headcountRange: headcountRangeMap,
  opportunityStage: opportunityStageMap,
  loseReason: loseReasonMap,
  orderStatus: orderStatusMap,
  orderInvoiceStatus: orderInvoiceStatusMap,
  paymentStatus: paymentStatusMap,
  paymentType: paymentTypeMap,
  refundType: refundTypeMap,
  invoiceStatus: invoiceStatusMap,
  invoiceType: invoiceTypeMap,
  invoiceItemType: invoiceItemTypeMap,
  keepRecordStatus: keepRecordStatusMap,
  keepRecordType: keepRecordTypeMap,
  visitStatus: visitStatusMap,
  visitType: visitTypeMap,
  workDailyStatus: workDailyStatusMap,
  reportType: reportTypeMap,
  salesActionItemCategory: salesActionItemCategoryMap,
  salesActionItemConfidence: salesActionItemConfidenceMap,
  salesActionItemStatus: salesActionItemStatusMap,
  salesActionItemDoneType: salesActionItemDoneTypeMap,
  projectStatus: projectStatusMap,
  projectCategory: projectCategoryMap,
  ticketStatus: ticketStatusMap,
  ticketPriority: ticketPriorityMap,
  ticketType: ticketTypeMap,
  productStatus: productStatusMap,
  productType: productTypeMap,
  productUnit: productUnitMap,
  employeeStatus: employeeStatusMap,
  departmentStatus: departmentStatusMap,
  gender: genderMap,
  userStatus: userStatusMap,
  cloudOwnerCategory: cloudOwnerCategoryMap,
  cloudRenewalIntent: cloudRenewalIntentMap,
  cloudAlertLevel: cloudAlertLevelMap,
  cloudAlertCategory: cloudAlertCategoryMap,
  cloudAlertStatus: cloudAlertStatusMap,
};

// ==================== 工具函数 ====================

export function getStatusLabel<T extends Record<string, { label: string; color: string }>>(
  status: keyof T | string,
  map: T
): string {
  if (status === null || status === undefined) {
    return '-';
  }
  return (map[status as keyof T]?.label as string) || status.toString();
}

export function getStatusColor<T extends Record<string, { label: string; color: string }>>(
  status: keyof T | string,
  map: T
): string {
  return (map[status as keyof T]?.color as string) || FALLBACK_COLOR;
}
