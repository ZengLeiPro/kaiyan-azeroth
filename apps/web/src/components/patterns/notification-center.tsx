import type { INotificationResponse } from '@ky-azeroth/shared/types/system';
import { format } from 'date-fns';
import { zhCN } from 'date-fns/locale';
import {
  AlertTriangle,
  Bell,
  Check,
  CheckCheck,
  ClipboardList,
  Loader2,
  Swords,
  X,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { api } from '@/lib/api';
import { logger } from '@/lib/logger';
import { isSafeInternalPath } from '@/lib/safe-navigation';
import { cn } from '@/lib/utils';

// UI 展示用通知类型（扩展 shared 的 type 枚举，增加 approval 用于审批通知图标）
type NotificationDisplayType = INotificationResponse['type'] | 'approval';

// UI 展示用通知 Profile（基于 shared 类型，添加 UI 扩展字段）
interface NotificationDisplay {
  id: string;
  type: NotificationDisplayType;
  title: string;
  message: string;
  link?: string;
  read: boolean;
  createdAt: string;
}

/**
 * 将 API 响应转换为 UI 展示用的通知对象
 */
function toNotificationDisplay(item: INotificationResponse): NotificationDisplay {
  return {
    id: item.id,
    type: mapNotificationDisplayType(item.type),
    title: item.title,
    message: item.content,
    link: item.link ?? undefined,
    read: item.isRead,
    createdAt: item.createdAt ?? new Date().toISOString(),
  };
}

function mapNotificationDisplayType(type: string | undefined): NotificationDisplayType {
  if (type === 'approval') return 'approval';
  if (type === 'sales_action') return 'sales_action';
  if (type === 'warning' || type === 'error' || type === 'success') return type;
  return 'info';
}

// 通知类型图标映射 - 使用 Shadcn 主题色
const typeIcons: Record<NotificationDisplayType, React.ReactNode> = {
  approval: <ClipboardList className="h-4 w-4 text-primary" />,
  warning: <AlertTriangle className="h-4 w-4 text-destructive" />,
  error: <AlertTriangle className="h-4 w-4 text-destructive" />,
  info: <Bell className="h-4 w-4 text-muted-foreground" />,
  success: <Check className="h-4 w-4 text-primary" />,
  // 销售数据闭环：缺口侦探/作战信号待办，用暖色作战图标 Swords（区别审批的 ClipboardList）。
  sales_action: <Swords className="h-4 w-4 text-rose-600 dark:text-rose-400" />,
};

// 通知类型背景颜色 - 使用 Shadcn 主题色
const typeBgColors: Record<NotificationDisplayType, string> = {
  approval: 'bg-primary/10 dark:bg-primary/20',
  warning: 'bg-destructive/10 dark:bg-destructive/20',
  error: 'bg-destructive/10 dark:bg-destructive/20',
  info: 'bg-muted dark:bg-muted',
  success: 'bg-primary/10 dark:bg-primary/20',
  // 销售数据闭环：暖色作战底色。
  sales_action: 'bg-rose-100 dark:bg-rose-900/30',
};

// 未读计数轮询间隔（60s）
const UNREAD_COUNT_POLL_INTERVAL = 60_000;

export function NotificationCenter() {
  const navigate = useNavigate();
  const [isOpen, setIsOpen] = useState(false);
  const [notifications, setNotifications] = useState<NotificationDisplay[]>([]);
  const [loading, setLoading] = useState(false);
  // 未读计数：独立于详情列表，由 /unread-count 维护
  const [unreadCount, setUnreadCount] = useState(0);

  // 获取未读计数
  const fetchUnreadCount = async () => {
    try {
      const response = await api.get<{ count: number }>('/notifications/unread-count');
      setUnreadCount(response.data?.count ?? 0);
    } catch (error) {
      logger.error('NotificationCenter', '获取未读计数失败:', error);
    }
  };

  // 获取通知列表
  const fetchNotifications = async () => {
    setLoading(true);
    try {
      const response = await api.get('/notifications');
      const rawItems: INotificationResponse[] = response.data.items;
      const items = rawItems.map(toNotificationDisplay);
      setNotifications(items);
      // 列表也回填一次未读计数（与 /unread-count 校准）
      setUnreadCount(items.filter((n) => !n.read).length);
    } catch (error) {
      logger.error('NotificationCenter', '获取通知失败:', error);
    } finally {
      setLoading(false);
    }
  };

  // 标记单条通知为已读
  const markAsRead = async (id: string) => {
    try {
      await api.post(`/notifications/${id}/read`);
      setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)));
      setUnreadCount((c) => Math.max(0, c - 1));
    } catch (error) {
      logger.error('NotificationCenter', '标记通知失败:', error);
    }
  };

  // 标记所有通知为已读
  const markAllAsRead = async () => {
    try {
      await api.post('/notifications/read-all');
      setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
      setUnreadCount(0);
    } catch (error) {
      logger.error('NotificationCenter', '标记全部已读失败:', error);
    }
  };

  // 处理通知点击
  const handleNotificationClick = (notification: NotificationDisplay) => {
    // 标记为已读
    if (!notification.read) {
      markAsRead(notification.id);
    }
    // 关闭下拉面板
    setIsOpen(false);
    // 跳转到对应链接
    if (isSafeInternalPath(notification.link)) {
      navigate(notification.link);
    }
  };

  // 初始加载未读计数 + 启动轮询
  useEffect(() => {
    fetchUnreadCount();
    const timer = window.setInterval(fetchUnreadCount, UNREAD_COUNT_POLL_INTERVAL);
    return () => window.clearInterval(timer);
  }, []);

  // 打开时拉详情列表
  useEffect(() => {
    if (isOpen) {
      fetchNotifications();
    }
  }, [isOpen]);

  // 格式化时间
  const formatTime = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return '刚刚';
    if (diffMins < 60) return `${diffMins}分钟前`;
    if (diffHours < 24) return `${diffHours}小时前`;
    if (diffDays < 7) return `${diffDays}天前`;
    return format(date, 'MM月dd日', { locale: zhCN });
  };

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative"
          data-testid="notification-button"
          aria-label="通知中心"
        >
          <Bell className="h-5 w-5" />
          {unreadCount > 0 && (
            <span
              className="absolute right-1.5 top-1.5 flex h-2.5 w-2.5 items-center justify-center rounded-full bg-destructive ring-1 ring-background"
              data-testid="notification-badge"
            >
              <span className="sr-only">{unreadCount > 99 ? '99+' : unreadCount}</span>
            </span>
          )}
        </Button>
      </PopoverTrigger>

      <PopoverContent className="w-96 p-0" align="end" data-testid="notification-dropdown">
        {/* 头部 */}
        <div className="flex items-center justify-between border-b px-4 py-3">
          <div className="flex items-center gap-2">
            <h3 className="font-semibold">通知中心</h3>
            {unreadCount > 0 && (
              <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                {unreadCount} 条未读
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {unreadCount > 0 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={markAllAsRead}
                className="h-auto px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
                data-testid="mark-all-read-button"
              >
                <CheckCheck className="mr-1 h-3.5 w-3.5" />
                全部已读
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={() => setIsOpen(false)}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* 通知列表 */}
        <div className="max-h-[400px] overflow-y-auto" data-testid="notification-list">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : notifications.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
              <Bell className="mb-2 h-10 w-10 opacity-20" />
              <p>暂无通知</p>
            </div>
          ) : (
            <div className="divide-y">
              {notifications.map((notification) => (
                <div
                  key={notification.id}
                  onClick={() => handleNotificationClick(notification)}
                  className={cn(
                    'flex cursor-pointer gap-3 px-4 py-3 transition-colors hover:bg-accent',
                    !notification.read && 'bg-muted/50'
                  )}
                  data-testid={`notification-item-${notification.id}`}
                  data-read={notification.read}
                  data-type={notification.type}
                >
                  {/* 图标 */}
                  <div
                    className={cn(
                      'flex h-9 w-9 shrink-0 items-center justify-center rounded-full',
                      typeBgColors[notification.type]
                    )}
                  >
                    {typeIcons[notification.type]}
                  </div>

                  {/* 内容 */}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span
                        className={cn(
                          'text-sm font-medium',
                          !notification.read ? 'text-foreground' : 'text-muted-foreground'
                        )}
                      >
                        {notification.title}
                      </span>
                      {!notification.read && <span className="h-2 w-2 rounded-full bg-primary" />}
                    </div>
                    <p className="mt-0.5 line-clamp-2 text-sm text-muted-foreground">
                      {notification.message}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {formatTime(notification.createdAt)}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 底部 */}
        {notifications.length > 0 && (
          <div className="border-t p-2">
            <Button
              variant="ghost"
              className="w-full text-xs text-primary hover:text-primary hover:underline"
              onClick={() => {
                setIsOpen(false);
                navigate('/notifications');
              }}
            >
              查看全部通知
            </Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
