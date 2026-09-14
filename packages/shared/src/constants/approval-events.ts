/**
 * 审批事件类型注册表
 *
 * 作用：
 * 1. 定义系统中所有可配置审批的业务模块
 * 2. 审批流程管理页面自动读取此表，显示所有可配置模块
 * 3. 新增业务表需要审批时，只需在此注册一行
 */

export interface ApprovalEventConfig {
  label: string;
  category: string;
  categoryLabel: string;
  sortOrder: number;
}

export const APPROVAL_EVENT_REGISTRY: Record<string, ApprovalEventConfig> = {
  // ===== CRM =====
  sale_order_activate: {
    label: '合同订单审批',
    category: 'crm',
    categoryLabel: 'CRM',
    sortOrder: 1,
  },
  invoice_approve: {
    label: '开票申请审批',
    category: 'crm',
    categoryLabel: 'CRM',
    sortOrder: 2,
  },
  payment_approve: {
    label: '回款审批',
    category: 'crm',
    categoryLabel: 'CRM',
    sortOrder: 3,
  },
  payment_refund_approve: {
    label: '退款审批',
    category: 'crm',
    categoryLabel: 'CRM',
    sortOrder: 4,
  },
  visit_approve: {
    label: '外出拜访审批',
    category: 'crm',
    categoryLabel: 'CRM',
    sortOrder: 5,
  },
  sale_order_change: {
    label: '合同订单变更审批',
    category: 'crm',
    categoryLabel: 'CRM',
    sortOrder: 6,
  },
  sale_order_void: {
    label: '合同订单纠错作废审批',
    category: 'crm',
    categoryLabel: 'CRM',
    sortOrder: 7,
  },
  invoice_change: {
    label: '开票变更审批',
    category: 'crm',
    categoryLabel: 'CRM',
    sortOrder: 8,
  },
  payment_change: {
    label: '回款变更审批',
    category: 'crm',
    categoryLabel: 'CRM',
    sortOrder: 9,
  },
  payment_refund_change: {
    label: '退款变更审批',
    category: 'crm',
    categoryLabel: 'CRM',
    sortOrder: 10,
  },
  visit_change: {
    label: '拜访变更审批',
    category: 'crm',
    categoryLabel: 'CRM',
    sortOrder: 11,
  },
  customer_tag_change: {
    label: '客户线索阶段变更审批',
    category: 'crm',
    categoryLabel: 'CRM',
    sortOrder: 12,
  },

  // ===== 项目管理 =====
  project_launch: {
    label: '项目立项审批',
    category: 'project',
    categoryLabel: '项目管理',
    sortOrder: 13,
  },
};

export type ApprovalEventType = keyof typeof APPROVAL_EVENT_REGISTRY;

/**
 * 获取按分类分组的事件列表
 * 用于审批流程管理页面
 */
export function getApprovalEventsByCategory(): Record<
  string,
  Array<{ eventType: string; categoryLabel: string } & ApprovalEventConfig>
> {
  const grouped: Record<
    string,
    Array<{ eventType: string; categoryLabel: string } & ApprovalEventConfig>
  > = {};

  Object.entries(APPROVAL_EVENT_REGISTRY).forEach(([eventType, config]) => {
    const category = config.category;
    if (!grouped[category]) {
      grouped[category] = [];
    }
    grouped[category].push({ eventType, ...config });
  });

  // 按 sortOrder 排序
  Object.values(grouped).forEach((items) => {
    items.sort((a, b) => a.sortOrder - b.sortOrder);
  });

  return grouped;
}

/**
 * 从注册表生成事件类型标签映射
 * 替代手动维护的 approvalEventTypeLabels
 */
export function getApprovalEventLabels(): Record<string, string> {
  const labels: Record<string, string> = {};
  Object.entries(APPROVAL_EVENT_REGISTRY).forEach(([eventType, config]) => {
    labels[eventType] = config.label;
  });
  return labels;
}
