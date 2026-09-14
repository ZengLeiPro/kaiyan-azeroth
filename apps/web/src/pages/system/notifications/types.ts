import type { INotification, INotificationResponse } from '@ky-azeroth/shared/types/system';
import { AlertTriangle, Bell, Check, ClipboardList } from 'lucide-react';
import React from 'react';

// @no-payload: 通知模块为只读展示，不支持用户编辑

/** UI 层通知类型（与 shared INotification.type 不同） */
export type NotificationType = 'system' | 'approval' | 'inventory' | 'order' | 'task';

/**
 * 通知展示类型（Profile）
 *
 * 强绑定 shared INotification，扩展 UI-only 字段。
 * 注意：uiType 是 UI 层的类型映射，shared 的 type 字段保持不变。
 */
export interface NotificationProfile extends INotificationResponse {
  /** UI-only: 前端展示用的通知类型（从 shared type 映射而来） */
  uiType: NotificationType;
  /** UI-only: 展示用消息（优先使用 message，fallback 到 content） */
  uiMessage: string;
  /** UI-only: 展示用已读状态（优先使用 read，fallback 到 isRead） */
  uiRead: boolean;
  /** UI-only: 可选的跳转链接 */
  uiLink?: string;
}

// 兼容旧代码
export type Notification = NotificationProfile;

export type NotificationFormData = Record<string, never>;

type RawNotificationResponse = INotification & {
  message?: string;
  link?: string | null;
  read?: boolean;
  notificationType?: string;
};

function mapNotificationType(type: INotification['type'] | string | undefined): NotificationType {
  switch (type) {
    case 'approval':
      return 'approval';
    case 'warning':
      return 'inventory';
    case 'error':
      return 'system';
    case 'success':
      return 'task';
    case 'info':
    default:
      return 'system';
  }
}

export function toNotificationProfile(response: RawNotificationResponse): NotificationProfile {
  return {
    ...response,
    // UI-only 扩展字段（不覆盖 shared 字段）
    uiType: mapNotificationType(response.type),
    uiMessage: response.message ?? response.content,
    uiRead: response.read ?? response.isRead,
    uiLink: response.link ?? undefined,
  };
}

/**
 * 数据转换函数：实体 -> 表单初始值
 *
 * 注意：通知模块为只读展示模块，不支持用户编辑，
 * 此函数返回空对象以满足类型规范要求。
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function toNotificationFormData(_entity: Notification): NotificationFormData {
  return {};
}

/**
 * 将表单数据转换为 API 提交格式
 * @description 通知模块为只读展示模块，不支持用户编辑。
 * 此函数仅用于满足类型规范要求。
 */
export function toNotificationPayload(form: NotificationFormData): NotificationFormData {
  return form;
}

export const typeConfig: Record<
  NotificationType,
  { label: string; icon: React.ReactNode; bgColor: string }
> = {
  system: {
    label: '系统',
    icon: React.createElement(Bell, { className: 'h-4 w-4 text-muted-foreground' }),
    bgColor: 'bg-muted',
  },
  approval: {
    label: '待审批',
    icon: React.createElement(ClipboardList, { className: 'h-4 w-4 text-primary' }),
    bgColor: 'bg-primary/10',
  },
  inventory: {
    label: '库存',
    icon: React.createElement(AlertTriangle, { className: 'h-4 w-4 text-destructive' }),
    bgColor: 'bg-destructive/10',
  },
  order: {
    label: '订单',
    icon: React.createElement(ClipboardList, { className: 'h-4 w-4 text-blue-500' }),
    bgColor: 'bg-blue-500/10',
  },
  task: {
    label: '任务',
    icon: React.createElement(Check, { className: 'h-4 w-4 text-primary' }),
    bgColor: 'bg-primary/10',
  },
};
