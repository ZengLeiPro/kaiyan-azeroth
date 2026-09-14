// 触发内置渲染器注册（副作用 import）
import '@/lib/column-renderers';

import { notificationResponseSchema } from '@ky-azeroth/shared/schemas/system';
import type { INotificationResponse } from '@ky-azeroth/shared/types/system';
import { format } from 'date-fns';
import { zhCN } from 'date-fns/locale';
import { Bell, CheckCheck, RefreshCw } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { z } from 'zod';

import { MobileBottomBar, MobileBottomBarSpacer } from '@/components/mobile';
import { CrudFilterBar } from '@/components/patterns/crud-filter-bar';
import { CrudTable } from '@/components/patterns/crud-table';
import { FilterBarSkeleton } from '@/components/patterns/filter-bar-skeleton';
import { GenericMobileCard } from '@/components/patterns/generic-mobile-card';
import { StandardToolbar } from '@/components/patterns/standard-toolbar';
import { StandardLayout } from '@/components/templates/standard-layout';
import { Button } from '@/components/ui/button';
import { useCrud } from '@/hooks/use-crud';
import { useFilterScheme } from '@/hooks/use-filter-scheme';
import { useManualFilter } from '@/hooks/use-manual-filter';
import { useIsMobile } from '@/hooks/use-mobile';
import { api } from '@/lib/api';
import { deriveColumnsFromSchema } from '@/lib/columns-from-schema';
import { formatDateTimeDisplay } from '@/lib/date-utils';
import { logger } from '@/lib/logger';
import { isSafeInternalPath } from '@/lib/safe-navigation';
import { cn } from '@/lib/utils';

import { Notification, NotificationFormData, toNotificationProfile, typeConfig } from './types';

export function NotificationsPage() {
  const isMobile = useIsMobile();
  const navigate = useNavigate();

  const [markingAll, setMarkingAll] = useState(false);

  const scheme = useFilterScheme('system.notifications');
  const filter = useManualFilter(
    scheme.initialFilters,
    (filters) => {
      const type = filters['filters[type][]'];
      const readStatus = filters['filters[readStatus]'];

      return {
        type: Array.isArray(type) && type.length ? type : undefined,
        read: readStatus === 'read' ? 'true' : readStatus === 'unread' ? 'false' : undefined,
      };
    },
    scheme.version
  );

  const transformData = useCallback(
    (items: INotificationResponse[]) => items.map(toNotificationProfile),
    []
  );

  const crud = useCrud<Notification, NotificationFormData, INotificationResponse>({
    endpoint: '/notifications',
    initialFormData: {},
    schema: z.object({}), // 只读页面，使用空 schema
    transformData,
    paginationOptions: {
      extraParams: filter.apiParams,
    },
  });

  const { data, pagination, refresh } = crud;

  const handleMarkAllAsRead = async () => {
    setMarkingAll(true);
    try {
      await api.post('/notifications/read-all');
      toast.success('已全部标记为已读');
      refresh();
    } catch {
      toast.error('操作失败');
    } finally {
      setMarkingAll(false);
    }
  };

  const handleNotificationClick = async (notification: Notification) => {
    if (!notification.uiRead) {
      try {
        await api.post(`/notifications/${notification.id}/read`);
      } catch (error) {
        logger.error('NotificationsPage', 'Failed to mark notification as read:', error);
      }
    }
    if (isSafeInternalPath(notification.uiLink)) {
      navigate(notification.uiLink);
    }
  };

  const unreadCount = data.filter((n) => !n.uiRead).length;

  /**
   * 列定义：从 `notificationResponseSchema` 派生列头/宽度，业务 render 在 overrides。
   * schema 的 `isRead` 字段对应"状态"列，页面 render 通过 `uiRead` 派生的 key 实际值
   * 未在 schema 中挂的"已读时间 readAt" 字段已派生；header 来自 meta。
   */
  const columns = useMemo(
    () =>
      deriveColumnsFromSchema<Notification>(notificationResponseSchema, {
        include: ['type', 'title', 'content', 'isRead', 'readAt'],
        overrides: [
          {
            key: 'type',
            render: (notification) => {
              const config = typeConfig[notification.uiType];
              return (
                <div className="flex items-center gap-2">
                  <span className={cn('rounded-full p-1.5', config.bgColor)}>{config.icon}</span>
                  <span className="text-sm">{config.label}</span>
                </div>
              );
            },
          },
          {
            key: 'title',
            render: (notification) => (
              <span
                className={cn(
                  'font-medium',
                  !notification.uiRead && 'text-foreground',
                  notification.uiRead && 'text-muted-foreground'
                )}
              >
                {notification.title}
              </span>
            ),
          },
          {
            key: 'content',
            header: '内容',
            render: (notification) => (
              <span
                className={cn(
                  'block max-w-[400px] truncate text-sm',
                  notification.uiRead && 'text-muted-foreground'
                )}
                title={notification.uiMessage}
              >
                {notification.uiMessage}
              </span>
            ),
          },
          {
            key: 'isRead',
            render: (notification) => (
              <span
                className={cn(
                  'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
                  notification.uiRead
                    ? 'bg-muted text-muted-foreground'
                    : 'bg-primary/10 text-primary'
                )}
              >
                {notification.uiRead ? '已读' : '未读'}
              </span>
            ),
          },
          {
            key: 'readAt',
            render: (notification) => (
              <span className="text-muted-foreground">
                {formatDateTimeDisplay(notification.readAt) || '-'}
              </span>
            ),
          },
        ],
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [navigate]
  );

  const renderMobileCard = (notification: Notification) => {
    const config = typeConfig[notification.uiType];
    return (
      <GenericMobileCard
        title={notification.title}
        icon={<Bell className="h-4 w-4" />}
        status={
          <span
            className={cn(
              'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
              notification.uiRead ? 'bg-muted text-muted-foreground' : 'bg-primary/10 text-primary'
            )}
          >
            {notification.uiRead ? '已读' : '未读'}
          </span>
        }
        className={cn(!notification.uiRead && 'border-primary/30 bg-primary/5')}
        fields={[
          {
            value: (
              <div className="flex items-center gap-2">
                <span className={cn('rounded-full p-1', config.bgColor)}>{config.icon}</span>
                <span className="text-xs text-muted-foreground">{config.label}</span>
              </div>
            ),
            fullWidth: true,
          },
          {
            value: notification.uiMessage,
            fullWidth: true,
            valueClassName: cn(
              'line-clamp-2',
              notification.uiRead ? 'text-muted-foreground' : 'text-foreground/80'
            ),
          },
          {
            label: '时间',
            value: notification.createdAt
              ? format(new Date(notification.createdAt), 'yyyy-MM-dd HH:mm', { locale: zhCN })
              : '-',
            valueClassName: 'text-xs text-muted-foreground',
          },
        ]}
        footer={
          notification.createdAt
            ? format(new Date(notification.createdAt), 'yyyy-MM-dd HH:mm', { locale: zhCN })
            : '-'
        }
        onClick={() => handleNotificationClick(notification)}
        testId={`notification-${notification.id}`}
      />
    );
  };

  return (
    <MobileBottomBarSpacer hasBottomBar={isMobile}>
      <StandardLayout
        toolbar={
          <StandardToolbar
            actions={
              <Button onClick={handleMarkAllAsRead} disabled={markingAll || unreadCount === 0}>
                <CheckCheck className="mr-2 h-4 w-4" />
                全部标记已读
              </Button>
            }
            onSearch={filter.search}
            onReset={filter.reset}
            filters={
              scheme.isLoading ? (
                <FilterBarSkeleton count={2} />
              ) : (
                <CrudFilterBar
                  fields={scheme.fields}
                  values={filter.tempFilters}
                  onChange={filter.setFilter}
                  personalFilter={
                    scheme.registry && scheme.config && scheme.defaultConfig
                      ? {
                          pageKey: scheme.registry.pageKey,
                          registry: scheme.registry,
                          config: scheme.config,
                          defaultConfig: scheme.defaultConfig,
                          onApply: filter.replaceFilters,
                        }
                      : undefined
                  }
                />
              )
            }
          />
        }
        pagination={pagination}
      >
        <div
          className={cn(
            'mb-6 grid gap-4 md:shrink-0 md:px-6',
            isMobile ? 'grid-cols-2' : 'md:grid-cols-4'
          )}
        >
          <div className="rounded-lg border bg-card p-4">
            <div className="text-sm text-muted-foreground">全部通知</div>
            <div className="mt-1 text-2xl font-bold">{pagination.total}</div>
          </div>
          <div className="rounded-lg border bg-card p-4">
            <div className="text-sm text-muted-foreground">未读通知</div>
            <div className="mt-1 text-2xl font-bold text-primary">{unreadCount}</div>
          </div>
        </div>

        <CrudTable
          {...crud.tableProps}
          data={data}
          columns={columns}
          loading={crud.loading}
          renderMobileCard={renderMobileCard}
          onRowClick={handleNotificationClick}
          hidePagination
          emptyState={{
            title: '暂无通知',
            description: '没有找到任何通知记录',
          }}
        />
      </StandardLayout>
      {isMobile && (
        <MobileBottomBar>
          <Button variant="outline" className="flex-1" onClick={refresh}>
            <RefreshCw className="mr-2 h-4 w-4" />
            刷新
          </Button>
          <Button
            className="flex-1"
            onClick={handleMarkAllAsRead}
            disabled={markingAll || unreadCount === 0}
          >
            <CheckCheck className="mr-2 h-4 w-4" />
            全部已读
          </Button>
        </MobileBottomBar>
      )}
    </MobileBottomBarSpacer>
  );
}
