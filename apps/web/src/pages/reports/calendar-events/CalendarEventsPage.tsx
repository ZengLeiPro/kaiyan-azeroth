// 触发内置渲染器注册（副作用 import）
import '@/lib/column-renderers';

import { calendarEventResponseSchema } from '@ky-azeroth/shared/schemas/calendar-event';
import { CalendarDays } from 'lucide-react';
import { useMemo, useState } from 'react';
import { z } from 'zod';

import { MobileBottomBarSpacer } from '@/components/mobile';
import { ResponsiveDialog } from '@/components/mobile/ResponsiveDialog';
import { CrudFilterBar } from '@/components/patterns/crud-filter-bar';
import { CrudTable } from '@/components/patterns/crud-table';
import { FilterBarSkeleton } from '@/components/patterns/filter-bar-skeleton';
import { FormField } from '@/components/patterns/form-field';
import { GenericMobileCard } from '@/components/patterns/generic-mobile-card';
import { ManualSyncButton } from '@/components/patterns/manual-sync-button';
import { StandardToolbar } from '@/components/patterns/standard-toolbar';
import { StandardLayout } from '@/components/templates/standard-layout';
import { Button } from '@/components/ui/button';
import { useCrud } from '@/hooks/use-crud';
import { useFilterScheme } from '@/hooks/use-filter-scheme';
import { useManualFilter } from '@/hooks/use-manual-filter';
import { useIsMobile } from '@/hooks/use-mobile';
import { deriveColumnsFromSchema } from '@/lib/columns-from-schema';
import { formatDateTimeDisplay } from '@/lib/date-utils';

import {
  type CalendarEventFormData,
  type CalendarEventProfile,
  toCalendarEventProfile,
} from './types';

export function CalendarEventsPage() {
  useIsMobile();
  const [viewDialogOpen, setViewDialogOpen] = useState(false);
  const [viewingEvent, setViewingEvent] = useState<CalendarEventProfile | null>(null);

  const scheme = useFilterScheme('reports.calendar_events');
  const filter = useManualFilter(
    scheme.initialFilters,
    (filters) => ({
      keyword: typeof filters.keyword === 'string' ? filters.keyword || undefined : undefined,
    }),
    scheme.version
  );

  const crud = useCrud<CalendarEventProfile, CalendarEventFormData>({
    endpoint: '/dingtalk-calendar-events',
    initialFormData: {},
    schema: z.object({}),
    transformData: (data) => data.map(toCalendarEventProfile),
    paginationOptions: {
      extraParams: filter.apiParams,
    },
  });

  const handleViewEvent = (event: CalendarEventProfile) => {
    setViewingEvent(event);
    setViewDialogOpen(true);
  };

  /**
   * 列定义：从 schema 派生 header/width，业务 render（加粗标题、zh-CN locale 时间、muted
   * 文字、截断描述）在 overrides 里保留。
   */
  const columns = useMemo(
    () =>
      deriveColumnsFromSchema<CalendarEventProfile>(calendarEventResponseSchema, {
        overrides: [
          {
            key: 'title',
            render: (event) => <span className="font-medium">{event.title || '-'}</span>,
          },
          {
            key: 'startTime',
            render: (event) => (
              <span className="text-muted-foreground">
                {event.startTime ? formatDateTimeDisplay(event.startTime) || '-' : '-'}
              </span>
            ),
          },
          {
            key: 'endTime',
            render: (event) => (
              <span className="text-muted-foreground">
                {event.endTime ? formatDateTimeDisplay(event.endTime) || '-' : '-'}
              </span>
            ),
          },
          {
            key: 'location',
            render: (event) => (
              <span className="text-muted-foreground">{event.location || '-'}</span>
            ),
          },
          {
            key: 'creator',
            render: (event) => (
              <span className="text-muted-foreground">{event.creator || '-'}</span>
            ),
          },
          {
            key: 'attendees',
            render: (event) => (
              <span className="text-muted-foreground">
                {event.attendees && event.attendees.length > 0 ? event.attendees.join(', ') : '-'}
              </span>
            ),
          },
          {
            key: 'description',
            render: (event) => {
              const text = event.description;
              if (!text) return '-';
              return (
                <span className="line-clamp-1 text-muted-foreground" title={text}>
                  {text.length > 30 ? `${text.slice(0, 30)}...` : text}
                </span>
              );
            },
          },
          {
            key: 'syncedAt',
            render: (event) => (
              <span className="text-muted-foreground">
                {event.syncedAt ? formatDateTimeDisplay(event.syncedAt) || '-' : '-'}
              </span>
            ),
          },
        ],
      }),
    []
  );

  const renderMobileCard = (event: CalendarEventProfile) => (
    <GenericMobileCard
      title={event.title || '未命名日程'}
      icon={<CalendarDays className="h-4 w-4" />}
      fields={[
        {
          label: '开始',
          value: event.startTime ? formatDateTimeDisplay(event.startTime) || '-' : '-',
        },
        {
          label: '结束',
          value: event.endTime ? formatDateTimeDisplay(event.endTime) || '-' : '-',
        },
        { label: '地点', value: event.location || '-' },
        { label: '创建者', value: event.creator || '-' },
      ]}
      onClick={() => handleViewEvent(event)}
      testId={`calendar-event-${event.id}`}
    />
  );

  return (
    <MobileBottomBarSpacer>
      <StandardLayout
        toolbar={
          <StandardToolbar
            onSearch={filter.search}
            onReset={filter.reset}
            filters={
              scheme.isLoading ? (
                <FilterBarSkeleton count={1} />
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
            actions={
              <ManualSyncButton
                endpoint="/dingtalk-sync/calendar"
                label="同步日程"
                onSuccess={crud.refresh}
                successMessage={(d) => `已同步 ${d.count} 条日程`}
                errorFallback="同步日程失败"
              />
            }
          />
        }
        pagination={crud.pagination}
      >
        <CrudTable
          {...crud.tableProps}
          data={crud.data}
          columns={columns}
          loading={crud.loading}
          onRowClick={handleViewEvent}
          renderMobileCard={renderMobileCard}
          hidePagination
          emptyState={{
            title: '暂无日程事件',
            description: '没有找到任何同步的日程事件记录',
            icon: <CalendarDays className="h-12 w-12 text-muted-foreground/50" />,
          }}
        />

        {/* 查看详情弹窗 */}
        <ResponsiveDialog
          open={viewDialogOpen}
          onOpenChange={setViewDialogOpen}
          title="日程事件详情"
          footer={
            <Button variant="outline" onClick={() => setViewDialogOpen(false)}>
              关闭
            </Button>
          }
        >
          {viewingEvent && (
            <div className="space-y-4 py-4">
              <FormField
                name="title"
                label="日程标题"
                forceView
                viewContent={viewingEvent.title || '-'}
              />
              <FormField
                name="startTime"
                label="开始时间"
                forceView
                viewContent={
                  viewingEvent.startTime
                    ? formatDateTimeDisplay(viewingEvent.startTime) || '-'
                    : '-'
                }
              />
              <FormField
                name="endTime"
                label="结束时间"
                forceView
                viewContent={
                  viewingEvent.endTime ? formatDateTimeDisplay(viewingEvent.endTime) || '-' : '-'
                }
              />
              <FormField
                name="location"
                label="地点"
                forceView
                viewContent={viewingEvent.location || '-'}
              />
              <FormField
                name="creator"
                label="创建者"
                forceView
                viewContent={viewingEvent.creator || '-'}
              />
              <FormField
                name="attendees"
                label="参与人"
                forceView
                viewContent={
                  viewingEvent.attendees && viewingEvent.attendees.length > 0
                    ? viewingEvent.attendees.join(', ')
                    : '-'
                }
              />
              <FormField
                name="description"
                label="描述"
                forceView
                viewContent={viewingEvent.description || '-'}
              />
              <FormField
                name="syncedAt"
                label="同步时间"
                forceView
                viewContent={
                  viewingEvent.syncedAt ? formatDateTimeDisplay(viewingEvent.syncedAt) || '-' : '-'
                }
              />
            </div>
          )}
        </ResponsiveDialog>
      </StandardLayout>
    </MobileBottomBarSpacer>
  );
}
