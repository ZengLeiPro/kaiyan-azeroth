/**
 * 状态值常量 - 前后端共享
 * 定义所有业务状态的英文值，与数据库保持一致
 * 配合 status-labels.ts 使用
 */

// ==================== 通用状态 ====================

/**
 * 通用记录状态值
 */
export const RECORD_STATUS = {
  ACTIVE: 'active',
  INACTIVE: 'inactive',
} as const;
export type RecordStatusValue = (typeof RECORD_STATUS)[keyof typeof RECORD_STATUS];

// ==================== CRM 状态 ====================

/**
 * 联系人状态值（客户接触状态）
 */
export const CONTACT_STATUS = {
  UNTOUCHED: '未接触',
  CALLED: '已电话',
  VISITED: '已拜访',
  ONLINE: '已线上沟通',
} as const;
export type ContactStatusValue = (typeof CONTACT_STATUS)[keyof typeof CONTACT_STATUS];

/**
 * 成交状态值
 */
export const DEAL_STATUS = {
  NOT_WON: '未赢单',
  WON: '已赢单',
  MULTI_WON: '多次赢单',
} as const;
export type DealStatusValue = (typeof DEAL_STATUS)[keyof typeof DEAL_STATUS];

/**
 * 线索阶段（MQL/SQL）—— 电销跟踪线索质量
 *
 * - MQL (Marketing Qualified Lead)：营销合格线索（市场/品牌触达后表现出兴趣）
 * - SQL (Sales Qualified Lead)：销售合格线索（电销/外勤已沟通确认有真实购买意向）
 *
 * 状态机：null → MQL/SQL（首次打标签）；MQL ↔ SQL（双向，含升级与退回）
 * 所有变更走审批；ADMIN 例外可直改。
 * 当前阶段不支持取消标签（不允许从 MQL/SQL 退回 null）。
 */
export const LEAD_STAGE = {
  MQL: 'MQL',
  SQL: 'SQL',
} as const;
export type LeadStageValue = (typeof LEAD_STAGE)[keyof typeof LEAD_STAGE];
export const LEAD_STAGE_VALUES = Object.values(LEAD_STAGE) as [LeadStageValue, ...LeadStageValue[]];

/**
 * Leads 推进状态。
 *
 * 与 leadStage（MQL/SQL）分开存储：阶段负责漏斗口径，推进状态负责销售下一步。
 */
export const LEAD_PROGRESS_STATUS = {
  ACTIVE: 'ACTIVE',
  NO_SHOW: 'NO_SHOW',
  PENDING_VISIT: 'PENDING_VISIT',
  VISITED: 'VISITED',
  WON: 'WON',
  LOST: 'LOST',
} as const;
export type LeadProgressStatusValue =
  (typeof LEAD_PROGRESS_STATUS)[keyof typeof LEAD_PROGRESS_STATUS];
export const LEAD_PROGRESS_STATUS_VALUES = Object.values(LEAD_PROGRESS_STATUS) as [
  LeadProgressStatusValue,
  ...LeadProgressStatusValue[],
];

/**
 * 跟进记录来源（KeepRecord.source 字段取值）
 *
 * - manual：销售/电销在 UI/CLI 手工创建
 * - action_item：SalesActionItem 被采纳时由系统自动创建
 * - dingtalk-sync：钉钉同步而来
 * - field_change：客户字段变更自动留底（首批用例：leadStage MQL/SQL 变更）
 */
export const KEEP_RECORD_SOURCE = {
  MANUAL: 'manual',
  ACTION_ITEM: 'action_item',
  DINGTALK_SYNC: 'dingtalk-sync',
  FIELD_CHANGE: 'field_change',
} as const;
export type KeepRecordSourceValue = (typeof KEEP_RECORD_SOURCE)[keyof typeof KEEP_RECORD_SOURCE];

/**
 * 客户等级值
 */
export const CUSTOMER_LEVEL = {
  S: 'S',
  A: 'A',
  B: 'B',
  C: 'C',
  D: 'D',
} as const;
export type CustomerLevelValue = (typeof CUSTOMER_LEVEL)[keyof typeof CUSTOMER_LEVEL];

/**
 * 客户来源值
 */
export const CUSTOMER_SOURCE = {
  SELF_DEVELOP: '自我开拓',
  OLD_CUSTOMER_REFERRAL: '老客户介绍',
  NETWORK_REFERRAL: '人脉圈介绍',
  WEBSITE_LEAD: '官网留资',
  TRIAL_SIGNUP: '试用注册',
  XIAOHONGSHU: '小红书',
  DOUYIN: '抖音',
  WECHAT_CHANNELS: '视频号',
  TIANYUAN_CUSTOMER: '天元客户流入',
  TIANYUAN_OPPORTUNITY: '天元商机流入',
  TIANYUAN_PUBLIC_POOL: '天元公海挑入',
  OTHER: '其他方式',
} as const;
export type CustomerSourceValue = (typeof CUSTOMER_SOURCE)[keyof typeof CUSTOMER_SOURCE];

/**
 * 商机阶段值
 */
export const OPPORTUNITY_STAGE = {
  DISCOVER: '发现需求',
  SOLUTION: '解决方案',
  NEGOTIATION: '商务谈判',
  CONTRACT: '合同签约',
  WON: '赢单',
  LOST: '输单流失',
} as const;
export type OpportunityStageValue = (typeof OPPORTUNITY_STAGE)[keyof typeof OPPORTUNITY_STAGE];

/**
 * 商机失单原因值
 *
 * 选「其他」时配合 `loseReasonDetail` 字段填写自由备注。
 * 历史脏数据已通过 migration 迁移：原 `loseReason` 自由文本搬到 `loseReasonDetail`，`loseReason` 统一置为 '其他'。
 */
export const OPPORTUNITY_LOSE_REASON = {
  NO_DEMAND: '客户无需求 / 暂不考虑',
  PRICE_BUDGET: '价格 / 预算不足',
  COMPETITOR_WON: '竞品胜出',
  UNREACHABLE: '联系不上客户',
  REQUIREMENT_MISMATCH: '需求不匹配',
  PROJECT_PAUSED: '项目搁置 / 决策延迟',
  OTHER: '其他',
} as const;
export type OpportunityLoseReasonValue =
  (typeof OPPORTUNITY_LOSE_REASON)[keyof typeof OPPORTUNITY_LOSE_REASON];
export const OPPORTUNITY_LOSE_REASON_VALUES = Object.values(OPPORTUNITY_LOSE_REASON) as [
  OpportunityLoseReasonValue,
  ...OpportunityLoseReasonValue[],
];

/**
 * 合同订单状态值（普通订单 5 态 + 历史冲正，由 SaleOrder.payment-summary.helper 自动派生）
 *
 * 派生规则（基于已审批通过的 Payment 求和）：
 *   gross     = SUM(IN  approved paymentAmount)
 *   refunded  = SUM(OUT approved paymentAmount)
 *   net       = gross - refunded
 *
 *   - gross = 0                                      → NOT_RECEIVED      未回款
 *   - refunded = 0 且 net < totalReceivables         → PARTIALLY_RECEIVED 部分回款
 *   - refunded = 0 且 net >= totalReceivables > 0    → FULLY_RECEIVED    全额回款
 *   - refunded > 0 且 refunded < gross               → PARTIALLY_REFUNDED 部分退款
 *   - refunded > 0 且 refunded >= gross > 0          → FULLY_REFUNDED    全额退款
 *   - legacyAdjustment=true                           → LEGACY_ADJUSTMENT 历史冲正
 *
 * 历史 NOT_REFUNDED ('未退款') 在迁移时统一回填为 NOT_RECEIVED ('未回款')
 * 或由 helper 在下次写入时自动覆盖（取决于既有数据的实际语义）。
 */
export const ORDER_STATUS = {
  NOT_RECEIVED: '未回款',
  PARTIALLY_RECEIVED: '部分回款',
  FULLY_RECEIVED: '全额回款',
  PARTIALLY_REFUNDED: '部分退款',
  FULLY_REFUNDED: '全额退款',
  LEGACY_ADJUSTMENT: '历史冲正',
} as const;
export type OrderStatusValue = (typeof ORDER_STATUS)[keyof typeof ORDER_STATUS];

/**
 * 回款方向（IN=回款 / OUT=退款）
 *
 * Payment 表通过 direction 字段承载双向资金流，避免新增 Refund 实体。
 * 一旦审批通过即冻结，update 接口禁止修改。
 */
export const PAYMENT_DIRECTION = {
  IN: 'IN',
  OUT: 'OUT',
} as const;
export type PaymentDirectionValue = (typeof PAYMENT_DIRECTION)[keyof typeof PAYMENT_DIRECTION];

/**
 * 退款类型（direction='OUT' 时必填）
 */
export const PAYMENT_REFUND_TYPE = {
  CUSTOMER_CANCEL: '客户取消',
  SERVICE_NOT_DELIVERED: '服务未交付',
  QUALITY_ISSUE: '质量问题',
  OVERPAY_REVERSAL: '超额冲正',
  DUPLICATE_TRANSFER: '重复转账',
  CONTRACT_TERMINATION: '解约',
  OTHER: '其他',
} as const;
export type PaymentRefundTypeValue = (typeof PAYMENT_REFUND_TYPE)[keyof typeof PAYMENT_REFUND_TYPE];
export const PAYMENT_REFUND_TYPE_VALUES = Object.values(PAYMENT_REFUND_TYPE) as [
  PaymentRefundTypeValue,
  ...PaymentRefundTypeValue[],
];

/**
 * PaymentItem 收款模式（绑定方案 v2.2）
 *
 * 销售下单时按 OrderProduct.paymentMode（继承 CrmProduct.defaultPaymentMode）默认，
 * 可手工调整。admin 专用 pass_through_cost 不出现在销售下单表单选项。
 *
 * - direct: 公司直收，派生 ledger 进 P&L 进账户
 * - dingtalk_collect: 钉钉天元代收，跳过 ledger 派生（佣金月结独立挂账）
 * - pass_through: 过单实收部分，派生 ledger 进 P&L 进账户
 * - pass_through_cost: 过单代付成本，跳过 ledger 派生（管理员手工录入代付成本；admin only）
 */
export const PAYMENT_MODE = {
  DIRECT: 'direct',
  DINGTALK_COLLECT: 'dingtalk_collect',
  PASS_THROUGH: 'pass_through',
  PASS_THROUGH_COST: 'pass_through_cost',
} as const;
export type PaymentModeValue = (typeof PAYMENT_MODE)[keyof typeof PAYMENT_MODE];
export const PAYMENT_MODE_VALUES = Object.values(PAYMENT_MODE) as [
  PaymentModeValue,
  ...PaymentModeValue[],
];
/** 销售下单可选模式（不含 pass_through_cost——那是 admin 调账专用） */
export const PAYMENT_MODE_VALUES_SALES = [
  PAYMENT_MODE.DIRECT,
  PAYMENT_MODE.DINGTALK_COLLECT,
  PAYMENT_MODE.PASS_THROUGH,
] as const;

/**
 * 回款状态值
 */
export const PAYMENT_STATUS = {
  PENDING: 'pending',
  CONFIRMED: 'confirmed',
  CANCELLED: 'cancelled',
} as const;
export type PaymentStatusValue = (typeof PAYMENT_STATUS)[keyof typeof PAYMENT_STATUS];

/**
 * 开票状态值
 *
 * - NORMAL：正常开票
 * - VOID：作废（开票方主动作废）
 * - RED_VOIDED：已冲红（红字发票冲销，原票不再计入"净开票额"）
 *
 * 净开票额口径：SUM(invoiceAmount WHERE status NOT IN [VOID, RED_VOIDED])
 * 只支持全额冲红；部分冲红场景 = 全冲 + 重开。
 */
export const INVOICE_STATUS = {
  NORMAL: '正常',
  VOID: '作废',
  RED_VOIDED: '已冲红',
} as const;
export type InvoiceStatusValue = (typeof INVOICE_STATUS)[keyof typeof INVOICE_STATUS];

/**
 * 订单维度的开票状态值
 *
 * 与 INVOICE_STATUS（发票自身的"正常/作废"）不同维度：
 * 这里描述的是某张订单的整体开票进度。
 * 由 SaleOrder.invoicedAmount 与 orderAmount 比较推导：
 *   invoicedAmount = 0                      → NOT_INVOICED
 *   invoicedAmount > 0 且 < orderAmount     → PARTIAL
 *   invoicedAmount >= orderAmount > 0       → FULLY_INVOICED
 *   orderAmount 为 null/0 且 invoicedAmount > 0 → FULLY_INVOICED（无金额对照）
 */
export const ORDER_INVOICE_STATUS = {
  NOT_INVOICED: '未开票',
  PARTIAL: '部分开票',
  FULLY_INVOICED: '已开完',
} as const;
export type OrderInvoiceStatusValue =
  (typeof ORDER_INVOICE_STATUS)[keyof typeof ORDER_INVOICE_STATUS];

/**
 * 跟进记录类型值（与数据库 keep_records.keepRecordType 已有数据对齐）
 *
 * 口径来源：有成 CRM 跟进记录 keep_type 字典的本地化值。
 * 注意：历史 "线上" / "拜访" 写法仅在极少量老数据里存在，保留在 LEGACY_* 里。
 */
export const KEEP_RECORD_TYPE = {
  PHONE: '电话',
  ONLINE: '网络',
  FACE_TO_FACE: '面访',
  OTHER: '其他',
} as const;
export type KeepRecordTypeValue = (typeof KEEP_RECORD_TYPE)[keyof typeof KEEP_RECORD_TYPE];

/**
 * 跟进记录页面表单类型选项。
 *
 * 说明：历史 Web 表单存储的是英文 key，YCCRM 同步数据存储的是本地化值；
 * 这里保留 Web 现有契约，避免影响历史数据。
 */

export const HAS_CONTACT_PHONE_VALUES = ['yes', 'no'] as const;
export type HasContactPhoneValue = (typeof HAS_CONTACT_PHONE_VALUES)[number];
export const HAS_CONTACT_PHONE_OPTIONS: ReadonlyArray<{
  value: HasContactPhoneValue;
  label: string;
}> = [
  { value: 'yes', label: '有' },
  { value: 'no', label: '无' },
];

export const KEEP_RECORD_TYPE_OPTIONS: { value: string; label: string }[] = [
  { value: 'phone', label: '电话' },
  { value: 'visit', label: '拜访' },
  { value: 'online_demo', label: '线上演示' },
  { value: 'dingtalk', label: '钉钉' },
  { value: 'wechat', label: '微信' },
  { value: 'email', label: '邮件' },
  { value: 'other', label: '其他' },
];

/**
 * 跟进记录类型 → 客户联系状态 映射
 *
 * 用于 CustomersService.computeContactStatus 与 dingtalk-sync 客户状态刷新共享同一套规则。
 *
 * ⚠️ 必须同时覆盖两套存储口径，否则有跟进记录的客户会被误判「未接触」：
 *   - YCCRM 同步数据存中文规范值（KEEP_RECORD_TYPE：电话/网络/面访/其他）
 *   - Web 表单本地新建存英文枚举值（KEEP_RECORD_TYPE_OPTIONS：phone/visit/dingtalk/wechat/email/other）
 * 2026-05-29 修复：此前仅覆盖中文子集，导致 163 户最新跟进为英文/微信/其他类型而被兜底「未接触」。
 */
export const KEEP_RECORD_TYPE_TO_CONTACT_STATUS: Record<string, string> = {
  // 当前规范值（YCCRM 同步数据，KEEP_RECORD_TYPE）
  电话: '已电话',
  网络: '已线上沟通',
  面访: '已拜访',
  其他: '已线上沟通',
  // Web 表单英文枚举值（KEEP_RECORD_TYPE_OPTIONS：本地新建跟进存这套）
  phone: '已电话',
  visit: '已拜访',
  online_demo: '已线上沟通',
  dingtalk: '已线上沟通',
  wechat: '已线上沟通',
  email: '已线上沟通',
  other: '已线上沟通',
  // 历史兼容值（极早期老数据）
  线上: '已线上沟通',
  拜访: '已拜访',
  微信: '已线上沟通',
};

/**
 * 跟进记录状态值
 */
export const KEEP_RECORD_STATUS = {
  FIRST_CONTACT: '初次建联',
  DEMAND_CONFIRM: '需求确认',
  SOLUTION_PROGRESS: '方案推进',
  PROMOTE: '促单',
  MAINTENANCE: '客户维护',
  AFTER_SALES: '售后跟进',
} as const;
export type KeepRecordStatusValue = (typeof KEEP_RECORD_STATUS)[keyof typeof KEEP_RECORD_STATUS];

/**
 * 拜访签到状态值
 */
export const VISIT_STATUS = {
  COMPLETED: '拜访完成',
} as const;
export type VisitStatusValue = (typeof VISIT_STATUS)[keyof typeof VISIT_STATUS];

/**
 * CRM 日报状态值
 */
export const WORK_DAILY_STATUS = {
  ON_TIME: '按时提交',
  LATE: '迟交',
} as const;
export type WorkDailyStatusValue = (typeof WORK_DAILY_STATUS)[keyof typeof WORK_DAILY_STATUS];

// ==================== 销售数据闭环：待办/作战项 ====================

/**
 * 销售数据待办类型值（category）
 * 进攻（今日作战卡）+ 防御（数据待办卡）。值与 Prisma SalesActionItem.category 一致。
 */
export const SALES_ACTION_ITEM_CATEGORY = {
  // 进攻
  WEBSITE_LEAD_NEW: 'WEBSITE_LEAD_NEW',
  FOLLOW_UP_DUE: 'FOLLOW_UP_DUE',
  DEAL_COOLING: 'DEAL_COOLING',
  PAYMENT_SILENT: 'PAYMENT_SILENT',
  CUSTOMER_STALE: 'CUSTOMER_STALE',
  // 防御
  GAP_HARD: 'GAP_HARD',
  GAP_SOFT: 'GAP_SOFT',
  CONFLICT: 'CONFLICT',
  FILL_CONFIRM: 'FILL_CONFIRM',
} as const;
export type SalesActionItemCategoryValue =
  (typeof SALES_ACTION_ITEM_CATEGORY)[keyof typeof SALES_ACTION_ITEM_CATEGORY];

/** 销售数据待办状态机值（status） */
export const SALES_ACTION_ITEM_STATUS = {
  PENDING: 'pending',
  ADOPTED: 'adopted',
  DONE: 'done',
  IGNORED: 'ignored',
  SNOOZED: 'snoozed',
  TRANSFERRED: 'transferred',
  AUTO_EXPIRED: 'auto_expired',
} as const;
export type SalesActionItemStatusValue =
  (typeof SALES_ACTION_ITEM_STATUS)[keyof typeof SALES_ACTION_ITEM_STATUS];

/** 销售数据待办办结类型值（doneType，仅 status=done 时使用） */
export const SALES_ACTION_ITEM_DONE_TYPE = {
  FOLLOW_RECORDED: 'follow_recorded',
  PROGRESSED: 'progressed',
  SHELVED: 'shelved',
  FALSE_ALARM: 'false_alarm',
  OTHER: 'other',
} as const;
export type SalesActionItemDoneTypeValue =
  (typeof SALES_ACTION_ITEM_DONE_TYPE)[keyof typeof SALES_ACTION_ITEM_DONE_TYPE];

/** 销售数据待办置信度值（confidence） */
export const SALES_ACTION_ITEM_CONFIDENCE = {
  HIGH: 'HIGH',
  MEDIUM: 'MEDIUM',
} as const;
export type SalesActionItemConfidenceValue =
  (typeof SALES_ACTION_ITEM_CONFIDENCE)[keyof typeof SALES_ACTION_ITEM_CONFIDENCE];

// ==================== 项目管理状态 ====================

/**
 * 项目状态值
 */
export const PROJECT_STATUS = {
  OPPORTUNITY: '商机中',
  CONTRACT: '合同中',
  NOT_STARTED: '未开始',
  DEMO: 'Demo',
  IN_PROGRESS: '进行中',
  TESTING: '测试',
  COMPLETED: '已完成',
  MAINTENANCE: '运维',
  PAUSED: '暂停',
  LOST: '流失',
} as const;
export type ProjectStatusValue = (typeof PROJECT_STATUS)[keyof typeof PROJECT_STATUS];

/**
 * 项目分类值
 */
export const PROJECT_CATEGORY = {
  CUSTOM_DEV: '定制开发',
  INTERNAL_PRODUCT: '内部产品',
  INTERNAL_SUPPORT: '内部支持',
  SAAS_PRODUCT: 'SaaS产品',
  TECH_SERVICE: '技术服务',
} as const;
export type ProjectCategoryValue = (typeof PROJECT_CATEGORY)[keyof typeof PROJECT_CATEGORY];

// ==================== CRM 扩展常量 ====================

/**
 * 客户关系值
 */
export const CUSTOMER_RELATIONSHIP = {
  COOPERATING: '合作客户',
  POTENTIAL: '潜在客户',
  LOST: '流失客户',
  COMPETITOR: '竞争对手',
  CHANNEL_PARTNER: '渠道伙伴',
  OTHER: '其他',
} as const;
export type CustomerRelationshipValue =
  (typeof CUSTOMER_RELATIONSHIP)[keyof typeof CUSTOMER_RELATIONSHIP];

/**
 * 客户标签选项值
 */
export const CUSTOMER_TAG_OPTIONS = {
  KEY_CUSTOMER: '重点客户',
  LOYAL_FAN: '铁杆粉丝',
  PRICE_SENSITIVE: '价格敏感',
  TECH_ORIENTED: '技术导向',
  FAST_DECISION: '决策快速',
  LONG_TERM: '长期合作',
  CLEAR_DEMAND: '需求明确',
  HIGH_POTENTIAL: '高潜力',
} as const;
export type CustomerTagValue = (typeof CUSTOMER_TAG_OPTIONS)[keyof typeof CUSTOMER_TAG_OPTIONS];

/**
 * 行业值（来源：有成 CRM 标准行业分类，与 customers.industry 历史数据保持一致）
 */
export const INDUSTRY = {
  MANUFACTURING: '制造',
  TRADE_RETAIL: '贸易/批发/零售',
  INTERNET_IT: '互联网/信息技术',
  ECOMMERCE: '电商',
  SERVICE: '服务',
  CONSTRUCTION: '建筑',
  EDUCATION: '教育',
  MEDIA_ENTERTAINMENT: '文体/娱乐/传媒',
  CATERING: '餐饮',
  REAL_ESTATE: '房地产',
  LOGISTICS: '运输/物流/仓储',
  GOVERNMENT: '政府/事业单位',
  HEALTHCARE: '医疗医药',
  BUSINESS_SERVICE: '商业服务/租赁',
  FINANCE: '金融',
  RESEARCH: '科研服务',
  PUBLIC_ENVIRONMENT: '公共/环境',
  UTILITIES: '电/热/燃气/水供应',
  SOCIAL_ORGANIZATION: '社会组织',
  AGRICULTURE: '农/林/牧/渔',
  MINING: '开采',
} as const;
export type IndustryValue = (typeof INDUSTRY)[keyof typeof INDUSTRY];

/**
 * 行业值数组（用于 z.enum 等场景）
 */
export const INDUSTRY_VALUES = Object.values(INDUSTRY) as [IndustryValue, ...IndustryValue[]];

/**
 * 人员规模值
 */
export const HEADCOUNT_RANGE = {
  RANGE_1_10: '1-10人',
  RANGE_11_50: '11-50人',
  RANGE_51_200: '51-200人',
  RANGE_201_500: '201-500人',
  RANGE_500_PLUS: '500人以上',
} as const;
export type HeadcountRangeValue = (typeof HEADCOUNT_RANGE)[keyof typeof HEADCOUNT_RANGE];

/**
 * 发票类型值
 */
export const INVOICE_TYPE = {
  E_SPECIAL: '电子专票',
  E_NORMAL: '电子普票',
  RECEIPT: '收据',
} as const;
export type InvoiceTypeValue = (typeof INVOICE_TYPE)[keyof typeof INVOICE_TYPE];

/**
 * 开票项目类型值
 */
export const INVOICE_ITEM_TYPE = {
  SOFTWARE: '软件费',
  HARDWARE: '硬件费',
  SERVICE: '服务费',
} as const;
export type InvoiceItemTypeValue = (typeof INVOICE_ITEM_TYPE)[keyof typeof INVOICE_ITEM_TYPE];

/**
 * 产品类型值（财报科目 × 产品归属 两段式：'{revenueCategory},{vendorType}'）
 *
 * 设计于 2026-06-07，目的：让 CRM 产品库的"分类"与外部回款表月度科目利润表对齐，
 * sale_orders/opportunities 的产品明细可按第一段（财报科目）group by 直接对齐财报。
 *
 * 第一段（财报科目）取值：钉钉转售收入 / 其他软件转售收入 / 自研软件销售收入 /
 *   硬件转售收入 / 定制开发收入 / 咨询配置收入 / 售后服务收入 / 外包人员服务收入 /
 *   其他业务收入 / 不再使用
 * 第二段（产品归属）取值：钉钉自家 / 钉钉生态ISV / 第三方独立 / 自研 / 结算项 / 脏数据
 *
 * 详见 assets/20260607/路径A调整记录.md
 */
export const PRODUCT_TYPE = {
  DT_RESELL_DT_OWN: '钉钉转售收入,钉钉自家',
  DT_RESELL_DT_ISV: '钉钉转售收入,钉钉生态ISV',
  OTHER_SW_RESELL: '其他软件转售收入,第三方独立',
  SELF_DEV_SW: '自研软件销售收入,自研',
  HW_RESELL_OWN: '硬件转售收入,自研',
  HW_RESELL_DT: '硬件转售收入,钉钉自家',
  CUSTOM_DEV: '定制开发收入,自研',
  CONSULTING_CONFIG: '咨询配置收入,自研',
  AFTER_SALES_OWN: '售后服务收入,自研',
  AFTER_SALES_DT: '售后服务收入,钉钉自家',
  OUTSOURCE: '外包人员服务收入,自研',
  DEPRECATED_SETTLEMENT: '不再使用,结算项',
  DEPRECATED_DIRTY: '不再使用,脏数据',
  DEPRECATED_VOID: '不再使用,作废',
} as const;
export type ProductTypeValue = (typeof PRODUCT_TYPE)[keyof typeof PRODUCT_TYPE];

/**
 * 产品单位值
 */
export const PRODUCT_UNIT = {
  SET: '套',
  PIECE: '个',
  UNIT: '台',
  YEAR: '年',
  MONTH: '月',
  TIME: '次',
  ITEM: '项',
} as const;
export type ProductUnitValue = (typeof PRODUCT_UNIT)[keyof typeof PRODUCT_UNIT];

// ==================== 基础档案状态 ====================

/**
 * 性别值
 */
export const GENDER = {
  MALE: '男',
  FEMALE: '女',
} as const;
export type GenderValue = (typeof GENDER)[keyof typeof GENDER];

/**
 * 员工状态值
 */
export const EMPLOYEE_STATUS = {
  ACTIVE: 'active',
  INACTIVE: 'inactive',
  RESIGNED: 'resigned',
} as const;
export type EmployeeStatusValue = (typeof EMPLOYEE_STATUS)[keyof typeof EMPLOYEE_STATUS];

/**
 * 部门状态值
 */
export const DEPARTMENT_STATUS = {
  ACTIVE: 'active',
  INACTIVE: 'inactive',
} as const;
export type DepartmentStatusValue = (typeof DEPARTMENT_STATUS)[keyof typeof DEPARTMENT_STATUS];

/** 用户状态 */
export const USER_STATUS = {
  ACTIVE: 'active',
  DISABLED: 'disabled',
  LOCKED: 'locked',
} as const;
export type UserStatusValue = (typeof USER_STATUS)[keyof typeof USER_STATUS];

// ==================== 权限数据范围 ====================

/**
 * RolePermission.viewScope 取值常量
 *
 * - SELF：仅本人（默认最小可见）
 * - ALL：全部数据
 *
 * 多角色合并：取最大范围（OR），任一角色为 ALL → 最终为 ALL
 */
export const VIEW_SCOPE = {
  SELF: 'SELF',
  ALL: 'ALL',
} as const;
export type ViewScope = (typeof VIEW_SCOPE)[keyof typeof VIEW_SCOPE];

/** 数据范围排序：值越大代表“范围越大”。用于多角色合并取 max */
export const VIEW_SCOPE_RANK: Record<ViewScope, number> = {
  SELF: 0,
  ALL: 1,
};

// ==================== 前端枚举提升（统一到 shared） ====================
// 以下常量原为 apps/web 页面本地 options，按 SSOT 提升到 shared。
// 仅用于 label 展示 / Badge 配色 / 表单选项 / 表格 columnMeta，不改变既有 create/update 校验口径。

/**
 * 拜访类型值（拜访记录 visitType；Web 表单存英文枚举）
 */
export const VISIT_TYPE = {
  FIRST_VISIT: 'first_visit',
  FOLLOW_UP: 'follow_up',
  MAINTENANCE: 'maintenance',
  DELIVERY: 'delivery',
  OTHER: 'other',
} as const;
export type VisitTypeValue = (typeof VISIT_TYPE)[keyof typeof VISIT_TYPE];

/**
 * 付款方式值（回款 paymentType；值即中文 label）
 */
export const PAYMENT_METHOD = {
  BANK_TRANSFER: '银行转账',
  ALIPAY: '支付宝',
  WECHAT: '微信支付',
  CASH: '现金',
  OTHER: '其他',
} as const;
export type PaymentMethodValue = (typeof PAYMENT_METHOD)[keyof typeof PAYMENT_METHOD];

/**
 * 工作日报报告类型值（reportType；Web 表单存英文枚举）
 */
export const WORK_DAILY_REPORT_TYPE = {
  DAILY: 'daily',
  WEEKLY: 'weekly',
  MONTHLY: 'monthly',
  TELESALES: 'telesales',
} as const;
export type WorkDailyReportTypeValue =
  (typeof WORK_DAILY_REPORT_TYPE)[keyof typeof WORK_DAILY_REPORT_TYPE];

/**
 * CRM 产品上下架状态值（productStatus）
 */
export const PRODUCT_STATUS = {
  ON_SALE: 'on_sale',
  OFF_SALE: 'off_sale',
} as const;
export type ProductStatusValue = (typeof PRODUCT_STATUS)[keyof typeof PRODUCT_STATUS];
