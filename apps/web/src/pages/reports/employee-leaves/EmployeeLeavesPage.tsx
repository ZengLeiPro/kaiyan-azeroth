// 触发内置渲染器注册（副作用 import）
import '@/lib/column-renderers';

import { employeeLeaveResponseSchema } from '@ky-azeroth/shared/schemas/employee-leave';
import { UserMinus } from 'lucide-react';
import { useMemo, useState } from 'react';
import { z } from 'zod';

import { MobileBottomBarSpacer } from '@/components/mobile';
import { ResponsiveDialog } from '@/components/mobile/ResponsiveDialog';
import { CrudFilterBar } from '@/components/patterns/crud-filter-bar';
import { CrudTable } from '@/components/patterns/crud-table';
import { FilterBarSkeleton } from '@/components/patterns/filter-bar-skeleton';
import { FormField } from '@/components/patterns/form-field';
import { GenericMobileCard } from '@/components/patterns/generic-mobile-card';
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
  type EmployeeLeaveFormData,
  type EmployeeLeaveProfile,
  toEmployeeLeaveProfile,
} from './types';

export function EmployeeLeavesPage() {
  useIsMobile();
  const [viewDialogOpen, setViewDialogOpen] = useState(false);
  const [viewingLeave, setViewingLeave] = useState<EmployeeLeaveProfile | null>(null);

  // 筛选字段 + 初始 state 全由服务端的 filter-scheme registry/config 驱动。
  const scheme = useFilterScheme('reports.employee_leaves');
  const filter = useManualFilter(scheme.initialFilters, undefined, scheme.version);

  const crud = useCrud<EmployeeLeaveProfile, EmployeeLeaveFormData>({
    endpoint: '/employee-leaves',
    initialFormData: {},
    schema: z.object({}),
    transformData: (data) => data.map(toEmployeeLeaveProfile),
    paginationOptions: {
      extraParams: filter.apiParams,
    },
  });

  const handleViewLeave = (leave: EmployeeLeaveProfile) => {
    setViewingLeave(leave);
    setViewDialogOpen(true);
  };

  /**
   * 列定义：从 `employeeLeaveResponseSchema` 派生列头/宽度/date/datetime 渲染。
   * 加粗/muted 文字/截断等业务化样式保留在 overrides。
   */
  const columns = useMemo(
    () =>
      deriveColumnsFromSchema<EmployeeLeaveProfile>(employeeLeaveResponseSchema, {
        overrides: [
          {
            key: 'name',
            render: (leave) => <span className="font-medium">{leave.name}</span>,
          },
          {
            key: 'mobile',
            render: (leave) => <span className="text-muted-foreground">{leave.mobile || '-'}</span>,
          },
          {
            key: 'leaveTime',
            render: (leave) => (
              <span className="text-muted-foreground">
                {leave.leaveTime ? new Date(leave.leaveTime).toLocaleDateString('zh-CN') : '-'}
              </span>
            ),
          },
          {
            key: 'leaveReason',
            render: (leave) => (
              <span className="text-muted-foreground">
                {leave.leaveReason
                  ? leave.leaveReason.length > 30
                    ? `${leave.leaveReason.slice(0, 30)}...`
                    : leave.leaveReason
                  : '-'}
              </span>
            ),
          },
          {
            key: 'syncedAt',
            render: (leave) => (
              <span className="text-muted-foreground">
                {leave.syncedAt ? formatDateTimeDisplay(leave.syncedAt) || '-' : '-'}
              </span>
            ),
          },
        ],
      }),
    []
  );

  const renderMobileCard = (leave: EmployeeLeaveProfile) => (
    <GenericMobileCard
      title={leave.name}
      icon={<UserMinus className="h-4 w-4" />}
      fields={[
        { label: '手机号', value: leave.mobile || '-' },
        {
          label: '离职时间',
          value: leave.leaveTime ? new Date(leave.leaveTime).toLocaleDateString('zh-CN') : '-',
        },
        {
          label: '原因',
          value: leave.leaveReason
            ? leave.leaveReason.length > 15
              ? `${leave.leaveReason.slice(0, 15)}...`
              : leave.leaveReason
            : '-',
        },
      ]}
      onClick={() => handleViewLeave(leave)}
      testId={`employee-leave-${leave.id}`}
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
        pagination={crud.pagination}
      >
        <CrudTable
          {...crud.tableProps}
          data={crud.data}
          columns={columns}
          loading={crud.loading}
          onRowClick={handleViewLeave}
          renderMobileCard={renderMobileCard}
          hidePagination
          emptyState={{
            title: '暂无离职记录',
            description: '没有找到任何员工离职记录',
            icon: <UserMinus className="h-12 w-12 text-muted-foreground/50" />,
          }}
        />

        {/* 查看详情弹窗 */}
        <ResponsiveDialog
          open={viewDialogOpen}
          onOpenChange={setViewDialogOpen}
          title="离职记录详情"
          footer={
            <Button variant="outline" onClick={() => setViewDialogOpen(false)}>
              关闭
            </Button>
          }
        >
          {viewingLeave && (
            <div className="space-y-4 py-4">
              <FormField name="name" label="姓名" forceView viewContent={viewingLeave.name} />
              <FormField
                name="mobile"
                label="手机号"
                forceView
                viewContent={viewingLeave.mobile || '-'}
              />
              <FormField
                name="dingtalkUserId"
                label="钉钉用户ID"
                forceView
                viewContent={viewingLeave.dingtalkUserId}
              />
              <FormField
                name="leaveTime"
                label="离职时间"
                forceView
                viewContent={
                  viewingLeave.leaveTime
                    ? new Date(viewingLeave.leaveTime).toLocaleDateString('zh-CN')
                    : '-'
                }
              />
              <FormField
                name="leaveReason"
                label="离职原因"
                forceView
                viewContent={viewingLeave.leaveReason || '-'}
              />
              <FormField
                name="syncedAt"
                label="同步时间"
                forceView
                viewContent={
                  viewingLeave.syncedAt ? formatDateTimeDisplay(viewingLeave.syncedAt) || '-' : '-'
                }
              />
            </div>
          )}
        </ResponsiveDialog>
      </StandardLayout>
    </MobileBottomBarSpacer>
  );
}
