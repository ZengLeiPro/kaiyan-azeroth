// 触发内置渲染器注册（副作用 import）
import '@/lib/column-renderers';

import { operationLogResponseSchema } from '@ky-azeroth/shared/schemas/system';
import { FileText } from 'lucide-react';
import { ReactNode, useMemo } from 'react';
import { z } from 'zod';

import { MobileBottomBarSpacer } from '@/components/mobile';
import {
  CrudFilterBar,
  type FilterFieldConfig,
  type FilterOption,
} from '@/components/patterns/crud-filter-bar';
import { CrudTable } from '@/components/patterns/crud-table';
import { FormDialog } from '@/components/patterns/form-dialog';
import { GenericMobileCard } from '@/components/patterns/generic-mobile-card';
import { StandardToolbar } from '@/components/patterns/standard-toolbar';
import { StandardLayout } from '@/components/templates/standard-layout';
import { Label } from '@/components/ui/label';
import { useCrud } from '@/hooks/use-crud';
import { useFilterScheme } from '@/hooks/use-filter-scheme';
import { useManualFilter } from '@/hooks/use-manual-filter';
import { useIsMobile } from '@/hooks/use-mobile';
import { deriveColumnsFromSchema } from '@/lib/columns-from-schema';
import { formatDateTimeDisplay } from '@/lib/date-utils';
import { cn } from '@/lib/utils';

import { moduleLabels, OperationLog, operationTypeColors, operationTypeLabels } from './types';

function renderOperator(log: OperationLog) {
  const account = log.operatorUsername;
  if (log.operatorName && account && account !== log.operatorName) {
    return (
      <span className="inline-flex min-w-0 flex-col">
        <span className="font-medium leading-tight">{log.operatorName}</span>
        <span className="truncate text-xs leading-tight text-muted-foreground">{account}</span>
      </span>
    );
  }

  return <span className="font-medium">{log.operator || '-'}</span>;
}

// 模块选项
const moduleOptions: FilterOption[] = Object.entries(moduleLabels).map(([value, label]) => ({
  value,
  label,
}));

// 操作类型选项
const operationTypeOptions: FilterOption[] = Object.entries(operationTypeLabels).map(
  ([value, label]) => ({
    value,
    label,
  })
);

// 筛选条件初始值
const initialFilters = {
  module: [] as string[],
  operationType: [] as string[],
  operator: '',
  dateFrom: '',
  dateTo: '',
};

type OperationLogFilterState = typeof initialFilters;

const operationLogFilterFields: FilterFieldConfig<OperationLogFilterState>[] = [
  {
    kind: 'multiSelect',
    key: 'module',
    label: '模块',
    options: moduleOptions,
    width: 'w-36',
  },
  {
    kind: 'multiSelect',
    key: 'operationType',
    label: '操作类型',
    options: operationTypeOptions,
    width: 'w-36',
  },
  {
    kind: 'text',
    key: 'operator',
    label: '操作人',
    placeholder: '请输入操作人',
    width: 'w-32',
  },
  {
    kind: 'dateRange',
    label: '日期范围',
    fromKey: 'dateFrom',
    toKey: 'dateTo',
    showQuickOptions: true,
  },
];

interface OperationLogViewProps {
  /** 顶部"日志类型"选择器节点，由父级 OperationLogsPage 注入到 filters 区起首 */
  logTypeSelector?: ReactNode;
}

/**
 * 操作日志视图（业务模块写操作记录）
 * 由 OperationLogsPage 根据 logType 选择渲染。
 */
export function OperationLogView({ logTypeSelector }: OperationLogViewProps) {
  const isMobile = useIsMobile();

  const scheme = useFilterScheme('system.operation_logs');

  // 保留现有查询参数映射，仅让个人配置控制控件的显示与顺序。
  const filter = useManualFilter(
    initialFilters,
    (filters) => ({
      module: filters.module.length ? filters.module : undefined,
      action: filters.operationType.length ? filters.operationType : undefined,
      operator: filters.operator || undefined,
      startDate: filters.dateFrom || undefined,
      endDate: filters.dateTo || undefined,
    }),
    scheme.version
  );

  const configuredFilterFields = useMemo(() => {
    const fieldKeyMap: Record<string, keyof OperationLogFilterState> = {
      module: 'module',
      action: 'operationType',
      operator: 'operator',
      createdAt: 'dateFrom',
    };
    const configuredKeys = scheme.config?.fields.map((item) => item.fieldKey) ?? [
      'module',
      'action',
      'operator',
      'createdAt',
    ];

    return configuredKeys.flatMap((fieldKey) => {
      const stateKey = fieldKeyMap[fieldKey];
      const field = operationLogFilterFields.find((item) =>
        item.kind === 'dateRange' || item.kind === 'numberRange'
          ? stateKey === item.fromKey
          : stateKey === item.key
      );
      return field ? [field] : [];
    });
  }, [scheme.config]);

  const crud = useCrud<OperationLog>({
    endpoint: '/operation-logs',
    initialFormData: {} as OperationLog,
    schema: z.object({}), // 只读页面，使用空 schema
    disableEdit: true, // 操作日志只读，禁用编辑
    disableDelete: true, // 操作日志不可删除
    paginationOptions: {
      extraParams: filter.apiParams,
    },
    getEntityName: (log) => log.operationDesc,
  });

  const renderDataComparison = (log: OperationLog) => {
    if (!log.beforeData && !log.afterData) {
      return <div className="text-muted-foreground">无详细数据</div>;
    }

    const allKeys = new Set([
      ...Object.keys(log.beforeData || {}),
      ...Object.keys(log.afterData || {}),
    ]);

    const changedFields: { key: string; before: unknown; after: unknown }[] = [];
    allKeys.forEach((key) => {
      const before = log.beforeData?.[key];
      const after = log.afterData?.[key];
      if (JSON.stringify(before) !== JSON.stringify(after)) {
        changedFields.push({ key, before, after });
      }
    });

    if (changedFields.length === 0) {
      return <div className="text-muted-foreground">无变更</div>;
    }

    return (
      <div className="space-y-2">
        {changedFields.map((field) => (
          <div key={field.key} className="rounded border p-2">
            <div className="mb-1 text-sm font-medium">{field.key}</div>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <div>
                <span className="text-muted-foreground">变更前: </span>
                <span className="text-red-600">
                  {field.before !== undefined ? JSON.stringify(field.before) : '(空)'}
                </span>
              </div>
              <div>
                <span className="text-muted-foreground">变更后: </span>
                <span className="text-green-600">
                  {field.after !== undefined ? JSON.stringify(field.after) : '(空)'}
                </span>
              </div>
            </div>
          </div>
        ))}
      </div>
    );
  };

  /**
   * 列定义：从 `operationLogResponseSchema` 派生列头/宽度；业务 render（badge、截断、
   * font-medium、muted）保留在 overrides。
   */
  const columns = useMemo(
    () =>
      deriveColumnsFromSchema<OperationLog>(operationLogResponseSchema, {
        include: [
          'createdAt',
          'operator',
          'module',
          'operationType',
          'operationDesc',
          'operatorIp',
        ],
        overrides: [
          {
            key: 'createdAt',
            render: (log) => (
              <span className="text-sm">{formatDateTimeDisplay(log.createdAt) || '-'}</span>
            ),
          },
          {
            key: 'operator',
            render: (log) => <span data-testid="log-operator">{renderOperator(log)}</span>,
          },
          {
            key: 'module',
            render: (log) => (
              <span data-testid="log-module">{moduleLabels[log.module] || log.module}</span>
            ),
          },
          {
            key: 'operationType',
            render: (log) => (
              <span data-testid="log-operation-type">
                <span
                  className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                    operationTypeColors[log.operationType] || 'bg-gray-100 text-gray-800'
                  }`}
                >
                  {operationTypeLabels[log.operationType] || log.operationType}
                </span>
              </span>
            ),
          },
          {
            key: 'operationDesc',
            render: (log) => (
              <span
                className="block max-w-[300px] truncate text-sm"
                title={log.operationDesc}
                data-testid="log-description"
              >
                {log.operationDesc}
              </span>
            ),
          },
          {
            key: 'operatorIp',
            render: (log) => (
              <span className="text-sm text-muted-foreground" data-testid="log-ip">
                {log.operatorIp}
              </span>
            ),
          },
        ],
      }),
    []
  );

  const renderMobileCard = (log: OperationLog) => (
    <GenericMobileCard
      title={log.operatorName || log.operator || '-'}
      icon={<FileText className="h-4 w-4" />}
      status={
        <span
          className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
            operationTypeColors[log.operationType] || 'bg-gray-100 text-gray-800'
          }`}
        >
          {operationTypeLabels[log.operationType] || log.operationType}
        </span>
      }
      fields={[
        { label: '模块', value: moduleLabels[log.module] || log.module },
        ...(log.operatorUsername && log.operatorUsername !== log.operatorName
          ? [{ label: '账号', value: log.operatorUsername, valueClassName: 'text-xs' }]
          : []),
        {
          label: '操作描述',
          value: log.operationDesc,
          fullWidth: true,
        },
        {
          label: '操作时间',
          value: formatDateTimeDisplay(log.createdAt) || '-',
          valueClassName: 'text-xs',
        },
        { label: 'IP', value: log.operatorIp, valueClassName: 'text-xs text-muted-foreground' },
      ]}
      footer={formatDateTimeDisplay(log.createdAt) || '-'}
      testId={`operation-log-${log.id}`}
    />
  );

  const selectedLog = crud.editingEntity;

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
                <CrudFilterBar
                  fields={configuredFilterFields}
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
          onRowClick={crud.openViewDialog}
          hidePagination
          emptyState={{
            title: '暂无操作日志',
            description: '没有找到任何记录',
            icon: <FileText className="h-12 w-12 text-muted-foreground/50" />,
          }}
        />

        <FormDialog {...crud.formDialogProps} variant="drawer" title="操作详情">
          {selectedLog && (
            <div className="col-span-1 space-y-4 md:col-span-2">
              <div className={cn('grid gap-4', isMobile ? 'grid-cols-1' : 'grid-cols-2')}>
                <div>
                  <Label className="text-muted-foreground">操作时间</Label>
                  <div className="mt-1" data-testid="detail-time">
                    {formatDateTimeDisplay(selectedLog.createdAt) || '-'}
                  </div>
                </div>
                <div>
                  <Label className="text-muted-foreground">操作人</Label>
                  <div className="mt-1" data-testid="detail-operator">
                    {renderOperator(selectedLog)}
                  </div>
                </div>
                <div>
                  <Label className="text-muted-foreground">模块</Label>
                  <div className="mt-1" data-testid="detail-module">
                    {moduleLabels[selectedLog.module] || selectedLog.module}
                  </div>
                </div>
                <div>
                  <Label className="text-muted-foreground">操作类型</Label>
                  <div className="mt-1" data-testid="detail-type">
                    <span
                      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                        operationTypeColors[selectedLog.operationType] ||
                        'bg-gray-100 text-gray-800'
                      }`}
                    >
                      {operationTypeLabels[selectedLog.operationType] || selectedLog.operationType}
                    </span>
                  </div>
                </div>
                <div>
                  <Label className="text-muted-foreground">IP地址</Label>
                  <div className="mt-1" data-testid="detail-ip">
                    {selectedLog.operatorIp}
                  </div>
                </div>
                <div>
                  <Label className="text-muted-foreground">目标对象</Label>
                  <div className="mt-1">
                    {selectedLog.targetName || selectedLog.targetId || '-'}
                  </div>
                </div>
              </div>

              <div>
                <Label className="text-muted-foreground">操作描述</Label>
                <div
                  className="mt-1 rounded border bg-muted/30 p-3"
                  data-testid="detail-description"
                >
                  {selectedLog.operationDesc}
                </div>
              </div>

              <div>
                <Label className="text-muted-foreground">数据变更</Label>
                <div className="mt-2" data-testid="detail-changes">
                  {renderDataComparison(selectedLog)}
                </div>
              </div>
            </div>
          )}
        </FormDialog>
      </StandardLayout>
    </MobileBottomBarSpacer>
  );
}
