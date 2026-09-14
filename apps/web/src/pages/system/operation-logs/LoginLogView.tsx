// 触发内置渲染器注册（副作用 import）
import '@/lib/column-renderers';

import { loginLogResponseSchema } from '@ky-azeroth/shared/schemas/system';
import { LogIn, LogOut } from 'lucide-react';
import { ReactNode, useMemo } from 'react';
import { z } from 'zod';

import { MobileBottomBarSpacer } from '@/components/mobile';
import { CrudTable } from '@/components/patterns/crud-table';
import { DateRangeFilter } from '@/components/patterns/date-range-filter';
import { GenericMobileCard } from '@/components/patterns/generic-mobile-card';
import { PersonalFilterControls } from '@/components/patterns/personal-filter-controls';
import { StandardToolbar } from '@/components/patterns/standard-toolbar';
import { StandardLayout } from '@/components/templates/standard-layout';
import { Input } from '@/components/ui/input';
import { MultiSelect } from '@/components/ui/select';
import { useCrud } from '@/hooks/use-crud';
import { useFilterScheme } from '@/hooks/use-filter-scheme';
import { useManualFilter } from '@/hooks/use-manual-filter';
import { useIsMobile } from '@/hooks/use-mobile';
import { deriveColumnsFromSchema } from '@/lib/columns-from-schema';
import { formatDateTimeDisplay } from '@/lib/date-utils';

import { type LoginLogProfile, toLoginLogProfile } from './types';

/**
 * 登录日志展示类型由 ./types.ts 强绑定 shared response。
 */

const actionTypeStyles: Record<string, { color: string; icon: typeof LogIn }> = {
  login: { color: 'bg-green-100 text-green-800', icon: LogIn },
  logout: { color: 'bg-blue-100 text-blue-800', icon: LogOut },
};

// status 值与 auth.service.ts:45 写入端对齐：'fail' 而非 'failed'
const statusStyles: Record<string, string> = {
  success: 'bg-green-100 text-green-800',
  fail: 'bg-red-100 text-red-800',
};

// 操作类型选项
const actionTypeOptions = [
  { value: 'login', label: '登录' },
  { value: 'logout', label: '登出' },
];

// 状态选项（与 auth.service 写入值对齐）
const statusOptions = [
  { value: 'success', label: '成功' },
  { value: 'fail', label: '失败' },
];

// 筛选条件初始值
const initialFilters = {
  username: '',
  actionType: [] as string[],
  status: [] as string[],
  dateFrom: '',
  dateTo: '',
};

interface LoginLogViewProps {
  /** 顶部"日志类型"选择器节点，由父级 OperationLogsPage 注入到 filters 区起首 */
  logTypeSelector?: ReactNode;
}

/**
 * 登录日志视图（用户登录/登出/失败记录）
 * 由 OperationLogsPage 根据 logType 选择渲染。
 */
export function LoginLogView({ logTypeSelector }: LoginLogViewProps) {
  useIsMobile(); // Hook called for consistency

  const scheme = useFilterScheme('system.login_logs');

  // 保留现有 DTO 参数语义，个人配置只负责手写控件的显示与顺序。
  const filter = useManualFilter(
    initialFilters,
    (filters) => ({
      username: filters.username || undefined,
      actionType: filters.actionType.length ? filters.actionType : undefined,
      status: filters.status.length ? filters.status : undefined,
      startDate: filters.dateFrom || undefined,
      endDate: filters.dateTo || undefined,
    }),
    scheme.version
  );

  const crud = useCrud<LoginLogProfile, Record<string, never>>({
    endpoint: '/login-logs',
    initialFormData: {},
    schema: z.object({}), // 只读页面，使用空 schema
    transformData: (data) => data.map(toLoginLogProfile),
    paginationOptions: {
      extraParams: filter.apiParams,
    },
  });

  /**
   * 列定义：从 `loginLogResponseSchema` 派生列头/宽度；
   * 登录/登出 badge、状态 badge、截断等保留在 overrides。
   */
  const columns = useMemo(
    () =>
      deriveColumnsFromSchema<LoginLogProfile>(loginLogResponseSchema, {
        include: [
          'createdAt',
          'employeeName',
          'username',
          'actionType',
          'status',
          'ip',
          'location',
          'failReason',
          'userAgent',
        ],
        overrides: [
          {
            key: 'createdAt',
            render: (log) => (
              <span data-testid="log-time">{formatDateTimeDisplay(log.createdAt) || '-'}</span>
            ),
          },
          {
            key: 'username',
            render: (log) => (
              <span className="font-medium" data-testid="log-username">
                {log.username}
              </span>
            ),
          },
          {
            key: 'employeeName',
            render: (log) => <span className="font-medium">{log.employeeName || '-'}</span>,
          },
          {
            key: 'actionType',
            render: (log) => {
              const style = actionTypeStyles[log.actionType];
              const ActionIcon = style?.icon || LogIn;
              return (
                <div data-testid="log-action-type">
                  <span
                    className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${
                      style?.color || 'bg-gray-100 text-gray-800'
                    }`}
                  >
                    <ActionIcon className="h-3 w-3" />
                    {log.actionType === 'login' ? '登录' : '登出'}
                  </span>
                </div>
              );
            },
          },
          {
            key: 'status',
            render: (log) => (
              <div data-testid="log-status">
                <span
                  className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                    statusStyles[log.status] || 'bg-gray-100 text-gray-800'
                  }`}
                >
                  {log.status === 'success' ? '成功' : '失败'}
                </span>
              </div>
            ),
          },
          {
            key: 'ip',
            render: (log) => <span data-testid="log-ip">{log.ip}</span>,
          },
          {
            key: 'location',
            render: (log) => <span className="text-muted-foreground">{log.location || '-'}</span>,
          },
          {
            key: 'failReason',
            render: (log) => <span className="text-red-600">{log.failReason || '-'}</span>,
          },
          {
            key: 'userAgent',
            render: (log) => {
              const ua = log.userAgent;
              if (!ua) return '-';
              return (
                <span className="line-clamp-1 text-muted-foreground" title={ua}>
                  {ua.length > 40 ? `${ua.slice(0, 40)}...` : ua}
                </span>
              );
            },
          },
        ],
      }),
    []
  );

  const renderMobileCard = (log: LoginLogProfile) => {
    const style = actionTypeStyles[log.actionType];
    const ActionIcon = style?.icon || LogIn;
    return (
      <GenericMobileCard
        title={log.employeeName || log.username}
        icon={<ActionIcon className="h-4 w-4" />}
        status={
          <span
            className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${
              style?.color || 'bg-gray-100 text-gray-800'
            }`}
          >
            {log.actionType === 'login' ? '登录' : '登出'}
          </span>
        }
        fields={[
          {
            label: '账号',
            value: log.username,
            valueClassName: 'text-xs text-muted-foreground',
          },
          {
            value: (
              <span
                className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                  statusStyles[log.status] || 'bg-gray-100 text-gray-800'
                }`}
              >
                {log.status === 'success' ? '成功' : '失败'}
              </span>
            ),
            fullWidth: true,
          },
          { label: 'IP', value: log.ip },
          {
            label: '时间',
            value: formatDateTimeDisplay(log.createdAt) || '-',
            valueClassName: 'text-xs',
          },
        ]}
        footer={formatDateTimeDisplay(log.createdAt) || '-'}
        testId={`login-log-${log.id}`}
      />
    );
  };

  const configuredFieldKeys = scheme.config?.fields.map((item) => item.fieldKey) ?? [
    'username',
    'actionType',
    'status',
    'createdAt',
  ];

  const renderFilterField = (fieldKey: string) => {
    switch (fieldKey) {
      case 'username':
        return (
          <div className="flex items-center gap-2">
            <label className="whitespace-nowrap text-sm text-muted-foreground">用户名</label>
            <Input
              value={filter.tempFilters.username}
              onChange={(e) => filter.setFilter('username', e.target.value)}
              placeholder="请输入用户名"
              className="h-9 w-36"
              data-testid="username-filter"
            />
          </div>
        );
      case 'actionType':
        return (
          <div className="flex items-center gap-2">
            <label className="whitespace-nowrap text-sm text-muted-foreground">操作类型</label>
            <MultiSelect
              value={filter.tempFilters.actionType}
              onChange={(vs) => filter.setFilter('actionType', vs)}
              options={actionTypeOptions}
              placeholder="全部"
              className="h-9 w-36"
              contentClassName="min-w-[240px] max-w-[calc(100vw-2rem)]"
            />
          </div>
        );
      case 'status':
        return (
          <div className="flex items-center gap-2">
            <label className="whitespace-nowrap text-sm text-muted-foreground">状态</label>
            <MultiSelect
              value={filter.tempFilters.status}
              onChange={(vs) => filter.setFilter('status', vs)}
              options={statusOptions}
              placeholder="全部"
              className="h-9 w-28"
              contentClassName="min-w-[240px] max-w-[calc(100vw-2rem)]"
            />
          </div>
        );
      case 'createdAt':
        return (
          <DateRangeFilter
            label="日期"
            startDate={filter.tempFilters.dateFrom}
            endDate={filter.tempFilters.dateTo}
            onStartDateChange={(d) => filter.setFilter('dateFrom', d)}
            onEndDateChange={(d) => filter.setFilter('dateTo', d)}
          />
        );
      default:
        return null;
    }
  };

  return (
    <MobileBottomBarSpacer>
      <StandardLayout
        toolbar={
          <StandardToolbar
            onSearch={filter.search}
            onReset={filter.reset}
            filters={
              <div className="flex flex-wrap items-center gap-4">
                {logTypeSelector}
                {configuredFieldKeys.map((fieldKey) => (
                  <div key={fieldKey} className="contents">
                    {renderFilterField(fieldKey)}
                  </div>
                ))}
                {scheme.registry && scheme.config && scheme.defaultConfig && (
                  <PersonalFilterControls
                    pageKey={scheme.registry.pageKey}
                    registry={scheme.registry}
                    config={scheme.config}
                    defaultConfig={scheme.defaultConfig}
                    values={filter.tempFilters}
                    onApply={(values) => filter.replaceFilters(values)}
                  />
                )}
              </div>
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
          renderMobileCard={renderMobileCard}
          onRowClick={() => {}}
          hidePagination
          emptyState={{
            title: '暂无登录日志',
            description: '没有找到任何记录',
          }}
        />
      </StandardLayout>
    </MobileBottomBarSpacer>
  );
}
