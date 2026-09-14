/**
 * 项目工单（ProjectTicket）相关常量 - 前后端共享
 *
 * 覆盖：
 * - 状态（PROJECT_TICKET_STATUS）
 * - 类型（PROJECT_TICKET_TYPE）
 * - 优先级（PROJECT_TICKET_PRIORITY）
 * - 视图（PROJECT_TICKET_VIEW）
 * - 通知类型（PROJECT_TICKET_NOTIFICATION_TYPE）
 * - 合法状态转移矩阵（PROJECT_TICKET_TRANSITIONS）
 * - 通知文案构造器（buildTicketNotification）
 */

// ==================== 状态 ====================

export const PROJECT_TICKET_STATUS = {
  PENDING: 'PENDING',
  IN_PROGRESS: 'IN_PROGRESS',
  COMPLETED: 'COMPLETED',
  CLOSED: 'CLOSED',
  CANCELLED: 'CANCELLED',
} as const;
export type ProjectTicketStatusValue =
  (typeof PROJECT_TICKET_STATUS)[keyof typeof PROJECT_TICKET_STATUS];

export const PROJECT_TICKET_STATUS_VALUES = Object.values(PROJECT_TICKET_STATUS) as [
  ProjectTicketStatusValue,
  ...ProjectTicketStatusValue[],
];

export const PROJECT_TICKET_STATUS_LABELS: Record<ProjectTicketStatusValue, string> = {
  PENDING: '待处理',
  IN_PROGRESS: '处理中',
  COMPLETED: '已完成',
  CLOSED: '已关闭',
  CANCELLED: '已取消',
};

export const PROJECT_TICKET_STATUS_OPTIONS = PROJECT_TICKET_STATUS_VALUES.map((value) => ({
  value,
  label: PROJECT_TICKET_STATUS_LABELS[value],
}));

// ==================== 类型 ====================

export const PROJECT_TICKET_TYPE = {
  REQUIREMENT: 'REQUIREMENT',
  CHANGE: 'CHANGE',
  OPS: 'OPS',
  BUG: 'BUG',
  OTHER: 'OTHER',
} as const;
export type ProjectTicketTypeValue = (typeof PROJECT_TICKET_TYPE)[keyof typeof PROJECT_TICKET_TYPE];

export const PROJECT_TICKET_TYPE_VALUES = Object.values(PROJECT_TICKET_TYPE) as [
  ProjectTicketTypeValue,
  ...ProjectTicketTypeValue[],
];

export const PROJECT_TICKET_TYPE_LABELS: Record<ProjectTicketTypeValue, string> = {
  REQUIREMENT: '需求',
  CHANGE: '变更',
  OPS: '运维',
  BUG: 'Bug',
  OTHER: '其他',
};

export const PROJECT_TICKET_TYPE_OPTIONS = PROJECT_TICKET_TYPE_VALUES.map((value) => ({
  value,
  label: PROJECT_TICKET_TYPE_LABELS[value],
}));

// ==================== 优先级 ====================

export const PROJECT_TICKET_PRIORITY = {
  HIGH: 'HIGH',
  MEDIUM: 'MEDIUM',
  LOW: 'LOW',
} as const;
export type ProjectTicketPriorityValue =
  (typeof PROJECT_TICKET_PRIORITY)[keyof typeof PROJECT_TICKET_PRIORITY];

export const PROJECT_TICKET_PRIORITY_VALUES = Object.values(PROJECT_TICKET_PRIORITY) as [
  ProjectTicketPriorityValue,
  ...ProjectTicketPriorityValue[],
];

export const PROJECT_TICKET_PRIORITY_LABELS: Record<ProjectTicketPriorityValue, string> = {
  HIGH: '高',
  MEDIUM: '中',
  LOW: '低',
};

export const PROJECT_TICKET_PRIORITY_OPTIONS = PROJECT_TICKET_PRIORITY_VALUES.map((value) => ({
  value,
  label: PROJECT_TICKET_PRIORITY_LABELS[value],
}));

// ==================== 视图 ====================

export const PROJECT_TICKET_VIEW = {
  DISPATCHED: 'DISPATCHED',
  ASSIGNED: 'ASSIGNED',
  ALL: 'ALL',
} as const;
export type ProjectTicketViewValue = (typeof PROJECT_TICKET_VIEW)[keyof typeof PROJECT_TICKET_VIEW];

export const PROJECT_TICKET_VIEW_VALUES = Object.values(PROJECT_TICKET_VIEW) as [
  ProjectTicketViewValue,
  ...ProjectTicketViewValue[],
];

export const PROJECT_TICKET_VIEW_LABELS: Record<ProjectTicketViewValue, string> = {
  DISPATCHED: '我派出的',
  ASSIGNED: '我的待办',
  ALL: '全部',
};

export const PROJECT_TICKET_VIEW_OPTIONS = PROJECT_TICKET_VIEW_VALUES.map((value) => ({
  value,
  label: PROJECT_TICKET_VIEW_LABELS[value],
}));

// ==================== 通知类型 ====================

export const PROJECT_TICKET_NOTIFICATION_TYPE = {
  CREATED: 'PROJECT_TICKET_CREATED',
  STARTED: 'PROJECT_TICKET_STARTED',
  COMPLETED: 'PROJECT_TICKET_COMPLETED',
  CLOSED: 'PROJECT_TICKET_CLOSED',
  CANCELLED: 'PROJECT_TICKET_CANCELLED',
  REASSIGNED: 'PROJECT_TICKET_REASSIGNED',
} as const;
export type ProjectTicketNotificationTypeValue =
  (typeof PROJECT_TICKET_NOTIFICATION_TYPE)[keyof typeof PROJECT_TICKET_NOTIFICATION_TYPE];

// ==================== 合法状态转移矩阵 ====================

/**
 * 合法的状态转换矩阵
 *
 * - PENDING    → IN_PROGRESS / COMPLETED / CANCELLED
 * - IN_PROGRESS → COMPLETED / CANCELLED
 * - COMPLETED   → CLOSED
 * - CLOSED      → （终态）
 * - CANCELLED   → （终态）
 */
export const PROJECT_TICKET_TRANSITIONS: Record<
  ProjectTicketStatusValue,
  ProjectTicketStatusValue[]
> = {
  PENDING: [
    PROJECT_TICKET_STATUS.IN_PROGRESS,
    PROJECT_TICKET_STATUS.COMPLETED,
    PROJECT_TICKET_STATUS.CANCELLED,
  ],
  IN_PROGRESS: [PROJECT_TICKET_STATUS.COMPLETED, PROJECT_TICKET_STATUS.CANCELLED],
  COMPLETED: [PROJECT_TICKET_STATUS.CLOSED],
  CLOSED: [],
  CANCELLED: [],
};

// ==================== 通知文案构造 ====================

/**
 * 用于构造通知文案的上下文
 */
export interface ProjectTicketNotificationContext {
  id: string;
  ticketNo: string;
  title: string;
  projectName?: string | null;
  dispatcherName?: string | null;
  assigneeName?: string | null;
  fromStatus?: ProjectTicketStatusValue | null;
  toStatus?: ProjectTicketStatusValue | null;
}

export interface ProjectTicketNotificationPayload {
  title: string;
  content: string;
  link: string;
}

/**
 * 根据通知类型构造站内通知的 { title, content, link }
 * 所有通知使用同一个跳转地址：/projects/tickets?ticketId=<id>
 */
export function buildTicketNotification(
  type: ProjectTicketNotificationTypeValue,
  ctx: ProjectTicketNotificationContext
): ProjectTicketNotificationPayload {
  const link = `/projects/tickets?ticketId=${ctx.id}`;
  const project = ctx.projectName ? `【${ctx.projectName}】` : '';
  const dispatcher = ctx.dispatcherName ?? '项目经理';
  const ticketLabel = `${project}${ctx.ticketNo} ${ctx.title}`;

  switch (type) {
    case PROJECT_TICKET_NOTIFICATION_TYPE.CREATED:
      return {
        title: '新工单已指派',
        content: `${dispatcher} 给你派发了新工单：${ticketLabel}`,
        link,
      };
    case PROJECT_TICKET_NOTIFICATION_TYPE.STARTED:
      return {
        title: '工单已开始处理',
        content: `${ctx.assigneeName ?? '接单人'} 已开始处理工单：${ticketLabel}`,
        link,
      };
    case PROJECT_TICKET_NOTIFICATION_TYPE.COMPLETED:
      return {
        title: '工单已完成',
        content: `${ctx.assigneeName ?? '接单人'} 已完成工单：${ticketLabel}，请验证并关闭`,
        link,
      };
    case PROJECT_TICKET_NOTIFICATION_TYPE.CLOSED:
      return {
        title: '工单已关闭',
        content: `工单 ${ticketLabel} 已关闭`,
        link,
      };
    case PROJECT_TICKET_NOTIFICATION_TYPE.CANCELLED:
      return {
        title: '工单已取消',
        content: `工单 ${ticketLabel} 已被取消`,
        link,
      };
    case PROJECT_TICKET_NOTIFICATION_TYPE.REASSIGNED:
      return {
        title: '工单已改派给你',
        content: `${dispatcher} 将工单 ${ticketLabel} 改派给你`,
        link,
      };
    default:
      return {
        title: '工单更新',
        content: `工单 ${ticketLabel} 有更新`,
        link,
      };
  }
}
