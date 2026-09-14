/**
 * 经营分析（/analytics）模块的响应 TS 类型
 *
 * 与 schemas/analytics.ts 配对：schema 定义入参契约，types 定义出参契约。
 *
 * 命名约定：
 * - 接口前缀 `IAnalytics...`，与项目其他业务 `IXxx` 一致
 * - 输出对象为「面板内容」语义而非"列表项"语义，避免与 paginated list 类型混淆
 */

// ==================== 公共 ====================

/**
 * 经营分析期间元信息
 *
 * 所有端点返回值都附带这段，前端无须解析 query 即可在 UI 上显示
 * "当前数据范围：2026-05-01 ~ 2026-05-17（本月至今）"。
 */
export interface IAnalyticsRangeMeta {
  preset: string;
  startDate: string; // 解析后实际起始 YYYY-MM-DD
  endDate: string; // 解析后实际结束 YYYY-MM-DD（含当日）
}

/**
 * 趋势点（折线 / 柱状图通用）
 */
export interface ITrendPoint {
  bucket: string; // 桶标签：2026-05-17 / 2026-W20 / 2026-05
  value: number; // 主指标值
  count?: number; // 可选：记录数（当 value 是金额时这里给计数）
}

/**
 * 分布项（饼图 / 横向柱通用）
 */
export interface IDistributionItem {
  key: string; // 维度键（如客户等级 'S'）
  label: string; // 中文显示标签（已翻译）
  count: number;
  percentage: number; // 0-100，保留 1 位小数
  amount?: number; // 可选：与 key 关联的金额
}

/**
 * 排行项（销售/客户/产品通用）
 */
export interface IRankingItem {
  id: string;
  name: string;
  value: number; // 主排序值
  hint?: string; // 辅助文案（如部门/客户数等）
}

// ==================== 跨盘总览（GET /analytics/overview） ====================

export interface IAnalyticsOverviewResponse {
  range: IAnalyticsRangeMeta;
  kpis: {
    newCustomersCount: number; // 当期新客数
    paymentAmount: number; // 当期回款金额
    newOrderAmount: number; // 当期新签订单金额
    activeProjectCount: number; // 在执行项目数
    totalEffortHours: number; // 当期总工时
    dailyKeepRecordAvg: number; // 期内日均跟进数
  };
  crmFunnelMini: Array<{ stage: string; count: number; amount: number }>;
  projectEffortMini: Array<{ projectId: string; projectName: string; hours: number }>;
  dauTrend: Array<{ bucket: string; value: number }>; // 近 14 天 DAU
  alerts: {
    sleepingSaCount: number; // 沉睡 S+A 级客户数
    overdueProjectCount: number; // 延期项目数
    pendingApprovalCount: number; // 堆积审批数
  };
}

// ==================== CRM 经营盘 ====================

/** GET /analytics/crm/kpis */
export interface ICrmKpisResponse {
  range: IAnalyticsRangeMeta;
  customerCount: number;
  opportunityCount: number;
  saleOrderCount: number;
  paymentAmount: number;
  accountsReceivableTotal: number;
  sleepingSaCount: number;
}

/** GET /analytics/crm/funnel */
export interface ICrmFunnelResponse {
  range: IAnalyticsRangeMeta;
  /** 6 阶段（发现需求 / 解决方案 / 商务谈判 / 合同签约 / 赢单 / 输单流失） */
  stages: Array<{ stage: string; count: number; amount: number }>;
}

/** GET /analytics/crm/trend */
export interface ICrmTrendResponse {
  range: IAnalyticsRangeMeta;
  metric: string;
  bucket: string; // 'day' | 'week' | 'month'
  points: ITrendPoint[];
}

/** GET /analytics/crm/distribution */
export interface ICrmDistributionResponse {
  dimension: string; // 'level' | 'source' | 'industry' | 'relationship'
  items: IDistributionItem[];
}

/** GET /analytics/crm/ranking */
export interface ICrmRankingResponse {
  range: IAnalyticsRangeMeta;
  dimension: string; // 'salesperson' | 'customer' | 'product'
  metric: string;
  items: IRankingItem[];
}

/** GET /analytics/crm/aging（应收账款账龄） */
export interface ICrmAgingResponse {
  /** 4 桶：0-30 / 31-60 / 61-90 / 90+ */
  buckets: Array<{
    label: string;
    customerCount: number;
    amount: number;
  }>;
  total: { customerCount: number; amount: number };
}

/** GET /analytics/crm/sleeping（沉睡 S+A 级客户） */
export interface ICrmSleepingResponse {
  items: Array<{
    customerId: string;
    customerName: string;
    customerLevel: string;
    chargerId: string | null;
    chargerName: string | null;
    lastKeepRecordTime: string | null; // ISO
    daysSinceLastKeep: number | null;
  }>;
  total: number;
}

// ==================== 项目交付盘 ====================

/** GET /analytics/projects/kpis */
export interface IProjectKpisResponse {
  range: IAnalyticsRangeMeta;
  activeProjectCount: number;
  totalProjectCount: number;
  newProjectCountMtd: number;
  overdueProjectCount: number;
  totalEffortHours: number;
  totalLaborCost: number; // 总工时人力成本（hourlyRate × actualTime）
  hourlyRateCoverage: number; // 0-100，hourlyRate 已配置员工占比，用于 hint
}

/** GET /analytics/projects/distribution */
export interface IProjectDistributionResponse {
  dimension: string; // 'status' | 'category'
  items: IDistributionItem[];
}

/**
 * GET /analytics/projects/effort
 *
 * 转发 effort-records/stats 5 个 groupBy 的结果（除 completion，由组织盘单独展示）
 * 复用 EffortStatsService。
 */
export interface IProjectEffortResponse {
  range: IAnalyticsRangeMeta;
  byProject: Array<{
    projectId: string;
    projectName: string;
    totalHours: number;
    participantCount: number;
  }>;
  byPerson: Array<{
    ownerId: string;
    ownerName: string;
    totalHours: number;
    recordCount: number;
    saturation: number; // 0-1（小数）
  }>;
  byWorkType: Array<{
    workType: string;
    totalHours: number;
    recordCount: number;
    percentage: number;
  }>;
  byCustomer: Array<{
    customerId: string;
    customerName: string;
    totalHours: number;
    totalCost: number;
  }>;
}

/** GET /analytics/projects/tickets */
export interface IProjectTicketsResponse {
  range: IAnalyticsRangeMeta;
  counts: {
    pending: number;
    inProgress: number;
    completed: number;
    closed: number;
    cancelled: number;
    overdue: number;
  };
  byType: IDistributionItem[];
  byPriority: IDistributionItem[];
  /** SLA 达成率（completedAt ≤ dueDate）/(completedAt 非空) */
  slaRate: number; // 0-100
  avgResolutionHours: number; // 平均解决小时
  avgClosureHours: number; // 平均闭环小时
}

/** GET /analytics/projects/overdue */
export interface IProjectOverdueResponse {
  items: Array<{
    projectId: string;
    projectName: string;
    customerName: string | null;
    ownerName: string | null;
    status: string;
    endDate: string;
    daysOverdue: number;
  }>;
  total: number;
}

// ==================== 组织效率盘 ====================

/** GET /analytics/organization/kpis */
export interface IOrgKpisResponse {
  range: IAnalyticsRangeMeta;
  activeHeadcount: number;
  newHiresInPeriod: number;
  leaversInPeriod: number;
  dau30d: number; // 近 30 天去重活跃员工数
  mau: number; // 30 天滚动 MAU
  syncStaleHint: {
    dingtalkLogsUpdatedAt: string | null;
    employeeLeavesUpdatedAt: string | null;
  };
}

/** GET /analytics/organization/completion */
export interface IOrgCompletionResponse {
  range: IAnalyticsRangeMeta;
  effort: { expectedSlots: number; filledSlots: number; rate: number }; // 工时填报
  crmDaily: { expectedSlots: number; filledSlots: number; rate: number }; // CRM 日报
  dingtalkDaily: { expectedSlots: number; filledSlots: number; rate: number }; // 钉钉日报
}

/** GET /analytics/organization/sales-activity */
export interface IOrgSalesActivityResponse {
  range: IAnalyticsRangeMeta;
  keepRecordDensity: IRankingItem[]; // 按销售排行
  visitTrend: ITrendPoint[]; // 拜访签到趋势
  keepRecordTypeDistribution: IDistributionItem[]; // 跟进类型饼
}

/** GET /analytics/organization/approval-sla */
export interface IOrgApprovalSlaResponse {
  range: IAnalyticsRangeMeta;
  /** 按 eventType 分组的端到端平均耗时 */
  endToEndByEventType: Array<{
    eventType: string;
    label: string;
    avgHours: number;
    sampleCount: number;
  }>;
  /** 按 nodeName 分组的节点停留时长 */
  nodeStay: Array<{
    nodeName: string;
    avgHours: number;
    sampleCount: number;
  }>;
  /** 通过率（approved / (approved + rejected + withdrawn)） */
  approveRate: number; // 0-100
  /** 当前堆积 Top10 审批人 */
  pendingTopApprovers: IRankingItem[];
}

/** GET /analytics/organization/headcount-trend */
export interface IOrgHeadcountTrendResponse {
  months: Array<{
    month: string; // YYYY-MM
    activeAtMonthEnd: number;
    newHires: number;
    leavers: number;
  }>;
}

/** GET /analytics/organization/department-overview */
export interface IOrgDepartmentOverviewResponse {
  tree: IOrgDepartmentNode[];
  /** 缺管理员的部门列表 */
  missingManagerDepartments: Array<{ id: string; name: string }>;
}

export interface IOrgDepartmentNode {
  id: string;
  name: string;
  managerId: string | null;
  managerName: string | null;
  directEmployeeCount: number;
  recursiveEmployeeCount: number; // 含子孙
  children: IOrgDepartmentNode[];
}
