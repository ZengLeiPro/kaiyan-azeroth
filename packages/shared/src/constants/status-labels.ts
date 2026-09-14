/**
 * 状态标签映射 - 前后端共享
 * 定义所有业务状态的中文显示标签，不含 UI 样式
 * 与 status-values.ts 中的值常量一一对应
 */

import type {
  ContactStatusValue,
  CustomerLevelValue,
  CustomerRelationshipValue,
  CustomerSourceValue,
  CustomerTagValue,
  DealStatusValue,
  DepartmentStatusValue,
  EmployeeStatusValue,
  GenderValue,
  HeadcountRangeValue,
  IndustryValue,
  InvoiceItemTypeValue,
  InvoiceStatusValue,
  InvoiceTypeValue,
  KeepRecordStatusValue,
  LeadProgressStatusValue,
  LeadStageValue,
  OpportunityStageValue,
  OrderInvoiceStatusValue,
  OrderStatusValue,
  PaymentStatusValue,
  ProductTypeValue,
  ProductUnitValue,
  ProjectCategoryValue,
  ProjectStatusValue,
  RecordStatusValue,
  SalesActionItemCategoryValue,
  SalesActionItemConfidenceValue,
  SalesActionItemDoneTypeValue,
  SalesActionItemStatusValue,
  UserStatusValue,
  VisitStatusValue,
  WorkDailyStatusValue,
} from './status-values';

// ==================== 通用状态 ====================

/**
 * 通用记录状态标签
 */
export const RECORD_STATUS_LABELS: Record<RecordStatusValue, string> = {
  active: '启用',
  inactive: '停用',
};

// ==================== CRM 状态 ====================

/**
 * 联系人状态标签（客户接触状态）
 */
export const CONTACT_STATUS_LABELS: Record<ContactStatusValue, string> = {
  未接触: '未接触',
  已电话: '已电话',
  已拜访: '已拜访',
  已线上沟通: '已线上沟通',
};

/**
 * 成交状态标签
 */
export const DEAL_STATUS_LABELS: Record<DealStatusValue, string> = {
  未赢单: '未赢单',
  已赢单: '已赢单',
  多次赢单: '多次赢单',
};

/**
 * 线索阶段标签（MQL/SQL）
 */
export const LEAD_STAGE_LABELS: Record<LeadStageValue, string> = {
  MQL: 'MQL (营销合格)',
  SQL: 'SQL (销售合格)',
};

/**
 * Leads 推进状态标签
 */
export const LEAD_PROGRESS_STATUS_LABELS: Record<LeadProgressStatusValue, string> = {
  ACTIVE: '活跃',
  NO_SHOW: '毁约待重启',
  PENDING_VISIT: '待拜访',
  VISITED: '已完成演示/拜访',
  WON: '已成交',
  LOST: '流失',
};

/**
 * 客户等级标签
 */
export const CUSTOMER_LEVEL_LABELS: Record<CustomerLevelValue, string> = {
  S: 'S级',
  A: 'A级',
  B: 'B级',
  C: 'C级',
  D: 'D级',
};

/**
 * 客户来源标签
 */
export const CUSTOMER_SOURCE_LABELS: Record<CustomerSourceValue, string> = {
  自我开拓: '自我开拓',
  老客户介绍: '老客户介绍',
  人脉圈介绍: '人脉圈介绍',
  官网留资: '官网留资',
  试用注册: '试用注册',
  小红书: '小红书',
  抖音: '抖音',
  视频号: '视频号',
  天元客户流入: '天元客户流入',
  天元商机流入: '天元商机流入',
  天元公海挑入: '天元公海挑入',
  其他方式: '其他方式',
};

/**
 * 商机阶段标签
 */
export const OPPORTUNITY_STAGE_LABELS: Record<OpportunityStageValue, string> = {
  发现需求: '发现需求',
  解决方案: '解决方案',
  商务谈判: '商务谈判',
  合同签约: '合同签约',
  赢单: '赢单',
  输单流失: '输单流失',
};

/**
 * 合同订单状态标签（普通订单 5 态 + 历史冲正，与 ORDER_STATUS 一致）
 */
export const ORDER_STATUS_LABELS: Record<OrderStatusValue, string> = {
  未回款: '未回款',
  部分回款: '部分回款',
  全额回款: '全额回款',
  部分退款: '部分退款',
  全额退款: '全额退款',
  历史冲正: '历史冲正',
};

/**
 * 回款状态标签
 */
export const PAYMENT_STATUS_LABELS: Record<PaymentStatusValue, string> = {
  pending: '待确认',
  confirmed: '已确认',
  cancelled: '已取消',
};

/**
 * 开票状态标签
 */
export const INVOICE_STATUS_LABELS: Record<InvoiceStatusValue, string> = {
  正常: '正常',
  作废: '作废',
  已冲红: '已冲红',
};

/**
 * 订单开票状态标签（订单维度推导，与发票自身的"正常/作废"是不同维度）
 */
export const ORDER_INVOICE_STATUS_LABELS: Record<OrderInvoiceStatusValue, string> = {
  未开票: '未开票',
  部分开票: '部分开票',
  已开完: '已开完',
};

/**
 * 跟进记录状态标签
 */
export const KEEP_RECORD_STATUS_LABELS: Record<KeepRecordStatusValue, string> = {
  初次建联: '初次建联',
  需求确认: '需求确认',
  方案推进: '方案推进',
  促单: '促单',
  客户维护: '客户维护',
  售后跟进: '售后跟进',
};

/**
 * 拜访签到状态标签
 */
export const VISIT_STATUS_LABELS: Record<VisitStatusValue, string> = {
  拜访完成: '拜访完成',
};

/**
 * CRM 日报状态标签
 */
export const WORK_DAILY_STATUS_LABELS: Record<WorkDailyStatusValue, string> = {
  按时提交: '按时提交',
  迟交: '迟交',
};

// ==================== 项目管理状态 ====================

/**
 * 项目状态标签
 */
export const PROJECT_STATUS_LABELS: Record<ProjectStatusValue, string> = {
  商机中: '商机中',
  合同中: '合同中',
  未开始: '未开始',
  Demo: 'Demo',
  进行中: '进行中',
  测试: '测试',
  已完成: '已完成',
  运维: '运维',
  暂停: '暂停',
  流失: '流失',
};

/**
 * 项目分类标签
 */
export const PROJECT_CATEGORY_LABELS: Record<ProjectCategoryValue, string> = {
  定制开发: '定制开发',
  内部产品: '内部产品',
  内部支持: '内部支持',
  SaaS产品: 'SaaS产品',
  技术服务: '技术服务',
};

// ==================== CRM 扩展标签 ====================

/**
 * 客户关系标签
 */
export const CUSTOMER_RELATIONSHIP_LABELS: Record<CustomerRelationshipValue, string> = {
  合作客户: '合作客户',
  潜在客户: '潜在客户',
  流失客户: '流失客户',
  竞争对手: '竞争对手',
  渠道伙伴: '渠道伙伴',
  其他: '其他',
};

/**
 * 客户标签标签
 */
export const CUSTOMER_TAG_LABELS: Record<CustomerTagValue, string> = {
  重点客户: '重点客户',
  铁杆粉丝: '铁杆粉丝',
  价格敏感: '价格敏感',
  技术导向: '技术导向',
  决策快速: '决策快速',
  长期合作: '长期合作',
  需求明确: '需求明确',
  高潜力: '高潜力',
};

/**
 * 行业标签
 */
export const INDUSTRY_LABELS: Record<IndustryValue, string> = {
  制造: '制造',
  '贸易/批发/零售': '贸易/批发/零售',
  '互联网/信息技术': '互联网/信息技术',
  电商: '电商',
  服务: '服务',
  建筑: '建筑',
  教育: '教育',
  '文体/娱乐/传媒': '文体/娱乐/传媒',
  餐饮: '餐饮',
  房地产: '房地产',
  '运输/物流/仓储': '运输/物流/仓储',
  '政府/事业单位': '政府/事业单位',
  医疗医药: '医疗医药',
  '商业服务/租赁': '商业服务/租赁',
  金融: '金融',
  科研服务: '科研服务',
  '公共/环境': '公共/环境',
  '电/热/燃气/水供应': '电/热/燃气/水供应',
  社会组织: '社会组织',
  '农/林/牧/渔': '农/林/牧/渔',
  开采: '开采',
};

/**
 * 人员规模标签
 */
export const HEADCOUNT_RANGE_LABELS: Record<HeadcountRangeValue, string> = {
  '1-10人': '1-10人',
  '11-50人': '11-50人',
  '51-200人': '51-200人',
  '201-500人': '201-500人',
  '500人以上': '500人以上',
};

/**
 * 发票类型标签
 */
export const INVOICE_TYPE_LABELS: Record<InvoiceTypeValue, string> = {
  电子专票: '电子专票',
  电子普票: '电子普票',
  收据: '收据',
};

/**
 * 开票项目类型标签
 */
export const INVOICE_ITEM_TYPE_LABELS: Record<InvoiceItemTypeValue, string> = {
  软件费: '软件费',
  硬件费: '硬件费',
  服务费: '服务费',
};

/**
 * 产品类型标签（财报科目 × 产品归属，两段式）
 *
 * value 即数据库 productTypes 字段实际存储的字符串（'{科目},{归属}'）；
 * label 是前端展示的简短中文（StatusBadge / 筛选下拉 / 表单 Select 共用）。
 *
 * 改动设计见 status-values.ts 的 PRODUCT_TYPE 注释。
 */
export const PRODUCT_TYPE_LABELS: Record<ProductTypeValue, string> = {
  '钉钉转售收入,钉钉自家': '钉钉转售（钉钉自家）',
  '钉钉转售收入,钉钉生态ISV': '钉钉转售（生态 ISV）',
  '其他软件转售收入,第三方独立': '其他软件转售',
  '自研软件销售收入,自研': '自研软件',
  '硬件转售收入,自研': '硬件转售',
  '硬件转售收入,钉钉自家': '硬件转售（钉钉硬件）',
  '定制开发收入,自研': '定制开发',
  '咨询配置收入,自研': '咨询配置',
  '售后服务收入,自研': '售后服务',
  '售后服务收入,钉钉自家': '售后服务（钉钉官方）',
  '外包人员服务收入,自研': '外包人员',
  '不再使用,结算项': '结算项（已弃用）',
  '不再使用,脏数据': '脏数据（已弃用）',
  '不再使用,作废': '作废',
};

/**
 * 产品单位标签
 */
export const PRODUCT_UNIT_LABELS: Record<ProductUnitValue, string> = {
  套: '套',
  个: '个',
  台: '台',
  年: '年',
  月: '月',
  次: '次',
  项: '项',
};

// ==================== 基础档案状态 ====================

/**
 * 性别标签
 */
export const GENDER_LABELS: Record<GenderValue, string> = {
  男: '男',
  女: '女',
};

/**
 * 员工状态标签
 */
export const EMPLOYEE_STATUS_LABELS: Record<EmployeeStatusValue, string> = {
  active: '在职',
  inactive: '离职',
  resigned: '已离职',
};

/**
 * 登录状态标签
 */
export const USER_STATUS_LABELS: Record<UserStatusValue, string> = {
  active: '启用',
  disabled: '禁用',
  locked: '锁定',
};

/**
 * 部门状态标签
 */
export const DEPARTMENT_STATUS_LABELS: Record<DepartmentStatusValue, string> = {
  active: '启用',
  inactive: '停用',
};

// ==================== 审批流程状态 ====================

/**
 * 审批实例状态标签
 */
export const APPROVAL_INSTANCE_STATUS_LABELS: Record<string, string> = {
  pending: '审批中',
  approved: '已通过',
  rejected: '已驳回',
  withdrawn: '已撤回',
};

/**
 * 审批任务状态标签
 */
export const APPROVAL_TASK_STATUS_LABELS: Record<string, string> = {
  pending: '待审批',
  approved: '已通过',
  rejected: '已驳回',
  skipped: '已跳过',
};

/**
 * 审批人类型标签
 */
export const APPROVER_TYPE_LABELS: Record<string, string> = {
  member: '指定人员',
  manager: '直属主管',
  role: '指定角色',
};

/**
 * 多人审批方式标签
 */
export const MULTI_APPROVAL_TYPE_LABELS: Record<string, string> = {
  and: '会签（所有人同意）',
  or: '或签（任意一人同意）',
  sequence: '依次审批',
};

/**
 * 审批事件类型标签
 */
export const APPROVAL_EVENT_TYPE_LABELS: Record<string, string> = {
  sale_order_activate: '合同订单审批',
  invoice_approve: '开票申请审批',
  payment_approve: '回款审批',
  payment_refund_approve: '退款审批',
  visit_approve: '外出拜访审批',
  sale_order_change: '合同订单变更审批',
  sale_order_void: '合同订单纠错作废审批',
  invoice_change: '开票变更审批',
  payment_change: '回款变更审批',
  payment_refund_change: '退款变更审批',
  visit_change: '拜访变更审批',
  customer_tag_change: '客户线索阶段变更审批',
  project_launch: '项目立项审批',
};

/**
 * 审批操作标签
 */
export const APPROVAL_ACTION_LABELS: Record<string, string> = {
  submit: '提交',
  approve: '通过',
  reject: '驳回',
  withdraw: '撤回',
  remind: '催办',
  auto_pass: '自动通过',
};

// ==================== 云成本运维 ====================

/**
 * 云预警等级标签
 */
export const CLOUD_ALERT_LEVEL_LABELS: Record<string, string> = {
  p0: 'P0',
  p1: 'P1',
  p2: 'P2',
};

/**
 * 云预警类别标签
 */
export const CLOUD_ALERT_CATEGORY_LABELS: Record<string, string> = {
  balance_low: '余额不足',
  package_low: '资源包余量低',
  package_expiring: '资源包即将到期',
  subscription_expiring: '订阅即将到期',
  spike_anomaly: '扣费突增',
  usage_anomaly: '用量异常',
  package_runout_early: '资源包提前耗尽',
};

/**
 * 云预警状态标签
 */
export const CLOUD_ALERT_STATUS_LABELS: Record<string, string> = {
  active: '待处理',
  resolved: '已处理',
  dismissed: '已忽略',
};

/**
 * 云资源续费意愿标签
 */
export const CLOUD_RENEWAL_INTENT_LABELS: Record<string, string> = {
  auto: '自动续费',
  manual: '手动续费',
  cancel: '到期不续',
  undecided: '未决策',
};

/**
 * 云资源归属类别标签
 */
export const CLOUD_OWNER_CATEGORY_LABELS: Record<string, string> = {
  internal: '内部',
  customer: '客户',
  experimental: '实验',
  unknown: '未标注',
};

// ==================== 前端枚举提升（统一到 shared） ====================

/**
 * 拜访类型标签
 */
export const VISIT_TYPE_LABELS: Record<string, string> = {
  first_visit: '初次拜访',
  follow_up: '跟进拜访',
  maintenance: '客情维护',
  delivery: '送货上门',
  other: '其他',
};

/**
 * 付款方式标签（值即 label）
 */
export const PAYMENT_METHOD_LABELS: Record<string, string> = {
  银行转账: '银行转账',
  支付宝: '支付宝',
  微信支付: '微信支付',
  现金: '现金',
  其他: '其他',
};

/**
 * 工作日报报告类型标签
 */
export const WORK_DAILY_REPORT_TYPE_LABELS: Record<string, string> = {
  daily: '日报',
  weekly: '周报',
  monthly: '月报',
  telesales: '电销日报',
};

/**
 * CRM 产品上下架状态标签
 */
export const PRODUCT_STATUS_LABELS: Record<string, string> = {
  on_sale: '在售',
  off_sale: '停售',
};

// ==================== 销售数据闭环：待办/作战项 ====================

/**
 * 销售数据待办类型标签（category）
 */
export const SALES_ACTION_ITEM_CATEGORY_LABELS: Record<SalesActionItemCategoryValue, string> = {
  WEBSITE_LEAD_NEW: '官网新线索',
  FOLLOW_UP_DUE: '跟进到期',
  DEAL_COOLING: '商机变冷',
  PAYMENT_SILENT: '应收静默',
  CUSTOMER_STALE: '客户失联',
  GAP_HARD: '硬缺口',
  GAP_SOFT: '软缺口',
  CONFLICT: '数据矛盾',
  FILL_CONFIRM: '补录确认',
};

/**
 * 销售数据待办状态标签（status）
 */
export const SALES_ACTION_ITEM_STATUS_LABELS: Record<SalesActionItemStatusValue, string> = {
  pending: '待处理',
  adopted: '已采纳',
  done: '已办结',
  ignored: '已忽略',
  snoozed: '已稍后',
  transferred: '已转交',
  auto_expired: '自动失效',
};

/**
 * 销售数据待办办结类型标签（doneType）
 */
export const SALES_ACTION_ITEM_DONE_TYPE_LABELS: Record<SalesActionItemDoneTypeValue, string> = {
  follow_recorded: '跟进情况',
  progressed: '推进',
  shelved: '暂搁',
  false_alarm: '误报',
  other: '其他',
};

/**
 * 销售数据待办置信度标签（confidence）
 */
export const SALES_ACTION_ITEM_CONFIDENCE_LABELS: Record<SalesActionItemConfidenceValue, string> = {
  HIGH: '高',
  MEDIUM: '疑似',
};

export const INTENT_TEMPERATURE_LABELS: Record<string, string> = {
  UNJUDGED: '未判断',
  HIGH: '高意向',
  MEDIUM: '中意向',
  LOW: '低意向',
  NONE: '无意向',
};

export const LEAD_VALIDITY_LABELS: Record<string, string> = {
  VALID: '有效',
  INVALID: '无效',
};

// ==================== 工具函数 ====================

/**
 * 从标签映射中获取状态标签
 * 如果状态为 null/undefined 返回 '-'，找不到对应标签则返回原始值字符串
 */
export function getStatusLabelFromMap<T extends Record<string, string>>(
  status: keyof T | string | null | undefined,
  labelMap: T
): string {
  if (status === null || status === undefined) {
    return '-';
  }
  return (labelMap[status as keyof T] as string) || String(status);
}
