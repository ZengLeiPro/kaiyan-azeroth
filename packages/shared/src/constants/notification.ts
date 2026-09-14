export const NOTIFICATION_TYPE = {
  INFO: 'info',
  APPROVAL: 'approval',
  WARNING: 'warning',
  ERROR: 'error',
  SUCCESS: 'success',
  // 销售数据闭环：缺口侦探/作战信号待办通知（前端铃铛图标分支在前端轨加）
  SALES_ACTION: 'sales_action',
} as const;

export type NotificationTypeValue = (typeof NOTIFICATION_TYPE)[keyof typeof NOTIFICATION_TYPE];
