// 触发内置渲染器/导出格式化器注册（副作用 import）
import '@/lib/column-renderers';
import '@/lib/column-export-formatters';

import {
  EFFORT_RECORD_TYPE_LABELS,
  EFFORT_WORK_TYPE_LABELS,
  type EffortRecordTypeValue,
  type EffortWorkTypeValue,
} from '@ky-azeroth/shared/constants';
import { effortRecordResponseSchema } from '@ky-azeroth/shared/schemas/effort-record';
import type { IEffortRecordResponse } from '@ky-azeroth/shared/types/effort-record';
import { CalendarRange, Clock } from 'lucide-react';
import { useCallback, useMemo } from 'react';

import { BulkDeleteConfirm } from '@/components/patterns/bulk-delete-confirm';
import { ColumnVisibilityDropdown } from '@/components/patterns/column-visibility';
import { CrudFilterBar } from '@/components/patterns/crud-filter-bar';
import { CrudTable } from '@/components/patterns/crud-table';
import { DeleteConfirm } from '@/components/patterns/delete-confirm';
import { EmployeeSelect } from '@/components/patterns/employee-select';
import { FilterBarSkeleton } from '@/components/patterns/filter-bar-skeleton';
import { FormDialog } from '@/components/patterns/form-dialog';
import { FormField } from '@/components/patterns/form-field';
import { GenericMobileCard } from '@/components/patterns/generic-mobile-card';
import { ProjectSelect } from '@/components/patterns/project-select';
import { createStandardActions } from '@/components/patterns/row-actions-helpers';
import { StandardToolbar } from '@/components/patterns/standard-toolbar';
import { WorkTypeSelect } from '@/components/patterns/work-type-select';
import { StandardLayout } from '@/components/templates/standard-layout';
import { Button } from '@/components/ui/button';
import { DatePicker } from '@/components/ui/date-picker';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useColumnVisibility } from '@/hooks/use-column-visibility';
import { useCrud } from '@/hooks/use-crud';
import { useFilterScheme } from '@/hooks/use-filter-scheme';
import { useManualFilter } from '@/hooks/use-manual-filter';
import { useIsMobile } from '@/hooks/use-mobile';
import { deriveColumnsFromSchema } from '@/lib/columns-from-schema';
import {
  formatDateDisplay,
  formatDateToLocalDateString,
  parseLocalDateString,
} from '@/lib/date-utils';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/stores/auth';

import {
  type EffortRecordFormData,
  effortRecordFormSchema,
  type EffortRecordProfile,
  toEffortRecordFormData,
  toEffortRecordPayload,
  toEffortRecordProfile,
} from '../types';

/**
 * 返回当前日期所在 ISO 周（周一到周日）的起止日期，格式 YYYY-MM-DD。
 * 用于 "本周" 快捷按钮填入 filter-scheme workDate dateRange。
 */
function getThisWeekRange(): { from: string; to: string } {
  const today = new Date();
  const dayOfWeek = today.getDay(); // 0=Sun,1=Mon,...,6=Sat
  const daysFromMonday = (dayOfWeek + 6) % 7; // Sun→6, Mon→0, ..., Sat→5
  const monday = new Date(today);
  monday.setDate(today.getDate() - daysFromMonday);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  return {
    from: formatDateToLocalDateString(monday),
    to: formatDateToLocalDateString(sunday),
  };
}

const EFFORT_RECORD_COLUMN_CONFIG = [
  { key: 'projectName', label: '项目名称', visible: true, canHide: false },
  { key: 'customerName', label: '客户', visible: true },
  { key: 'actualTime', label: '实际工时', visible: true },
  { key: 'ownerName', label: '记录人', visible: true },
  { key: 'recordType', label: '记录类型', visible: true },
  { key: 'startDate', label: '开始日期', visible: true },
  { key: 'endDate', label: '结束日期', visible: true },
  { key: 'workType', label: '工时类型', visible: true },
  { key: 'description', label: '工时描述', visible: true },
  { key: 'createdAt', label: '创建时间', visible: false },
];

export function RecordListView() {
  const isMobile = useIsMobile();
  const { hasMenuPermission, hasViewScopeAll, user } = useAuthStore();
  const canEdit = hasMenuPermission('projects', 'effort_records', 'edit');
  const canDelete = hasMenuPermission('projects', 'effort_records', 'delete');
  const canSeeAllRecords = hasViewScopeAll('projects', 'effort_records');

  // 筛选字段 + 初始 state 全由服务端的 filter-scheme registry/config 驱动。
  const scheme = useFilterScheme('projects.effort_records');
  const filter = useManualFilter(scheme.initialFilters, undefined, scheme.version);

  const crud = useCrud<EffortRecordProfile, EffortRecordFormData, IEffortRecordResponse>({
    endpoint: '/effort-records',
    requireVersion: true,
    schema: effortRecordFormSchema,
    validateMode: 'onSubmit',
    initialFormData: {
      projectId: '',
      actualTime: 0,
      description: '',
      workType: null,
      startDate: null,
      endDate: null,
      ownerId: canSeeAllRecords ? null : (user?.employee?.id ?? null),
    },
    entityToForm: toEffortRecordFormData,
    formToPayload: (form) => toEffortRecordPayload(form),
    getEntityName: (record) => record.projectName || record.id,
    transformData: (data) => data.map(toEffortRecordProfile),
    paginationOptions: {
      initialSortBy: 'createdAt',
      initialSortOrder: 'desc',
      extraParams: filter.apiParams,
    },
  });

  const columnVisibility = useColumnVisibility(EFFORT_RECORD_COLUMN_CONFIG, {
    onServerSortingApplied: crud.sorting.applyServerSorting,
  });

  // "本周" 快捷按钮：把 workDate 字段的 from/to 填成本周一到周日，随后触发 search + refresh。
  // 仅当 scheme 中启用了 workDate dateRange 控件（即 initialFilters 里存在对应 key）才生效。
  const WORK_DATE_FROM_KEY = 'filters[workDate][from]';
  const WORK_DATE_TO_KEY = 'filters[workDate][to]';

  const applyThisWeek = useCallback(() => {
    const { from, to } = getThisWeekRange();
    filter.setFilters({
      [WORK_DATE_FROM_KEY]: from,
      [WORK_DATE_TO_KEY]: to,
    });
    // 等下一个 event loop 让 tempFilters 更新完，再 search + refresh
    setTimeout(() => {
      filter.search();
      crud.refresh();
    }, 0);
  }, [filter, crud]);

  const hasWorkDateField =
    WORK_DATE_FROM_KEY in scheme.initialFilters && WORK_DATE_TO_KEY in scheme.initialFilters;

  // 表格列：从 `effortRecordResponseSchema` 派生 header/width/sortable；页面 overrides
  // 保留业务化渲染（actualTime 加 h 后缀、recordType 蓝色/灰色区分、workType label 翻译、
  // 日期本地化格式化）。createdAt 使用内置 'date' 渲染器。
  const columns = useMemo(
    () =>
      deriveColumnsFromSchema<EffortRecordProfile>(effortRecordResponseSchema, {
        overrides: [
          {
            key: 'projectName',
            render: (record) => <span className="font-medium">{record.projectName || '-'}</span>,
          },
          {
            key: 'customerName',
            render: (record) => (
              <span className="text-muted-foreground">{record.customerName || '-'}</span>
            ),
          },
          {
            key: 'actualTime',
            render: (record) => (
              <span className="font-medium">{Number(record.actualTime).toFixed(1)}h</span>
            ),
          },
          {
            key: 'ownerName',
            render: (record) => (
              <span className="text-muted-foreground">{record.ownerName || '-'}</span>
            ),
          },
          {
            key: 'recordType',
            render: (record) => {
              const label = record.recordType
                ? (EFFORT_RECORD_TYPE_LABELS[record.recordType as EffortRecordTypeValue] ??
                  record.recordType)
                : '实际工时';
              const isPlan = record.recordType === 'PLAN';
              return (
                <span className={cn('text-xs', isPlan ? 'text-blue-600' : 'text-muted-foreground')}>
                  {label}
                </span>
              );
            },
          },
          {
            key: 'startDate',
            render: (record) => (
              <span className="text-muted-foreground">
                {record.startDate ? new Date(record.startDate).toLocaleDateString('zh-CN') : '-'}
              </span>
            ),
          },
          {
            key: 'endDate',
            render: (record) => (
              <span className="text-muted-foreground">
                {record.endDate ? new Date(record.endDate).toLocaleDateString('zh-CN') : '-'}
              </span>
            ),
          },
          {
            key: 'workType',
            render: (record) => {
              const label = record.workType
                ? (EFFORT_WORK_TYPE_LABELS[record.workType as EffortWorkTypeValue] ??
                  record.workType)
                : '-';
              return <span className="text-muted-foreground">{label}</span>;
            },
          },
          {
            key: 'description',
            render: (record) => {
              const text = record.description;
              if (!text) return '-';
              return (
                <span className="line-clamp-1" title={text}>
                  {text}
                </span>
              );
            },
          },
        ],
      }),
    []
  );

  const rowActions = useMemo(
    () =>
      createStandardActions<EffortRecordProfile>({
        onView: crud.openViewDialog,
        onEdit: crud.openEditDialog,
        onDelete: crud.openDeleteDialog,
        hideEdit: !canEdit,
        hideDelete: !canDelete,
      }),
    [crud.openViewDialog, crud.openEditDialog, crud.openDeleteDialog, canEdit, canDelete]
  );

  const renderMobileCard = (record: EffortRecordProfile) => (
    <GenericMobileCard
      title={record.projectName || '未关联项目'}
      fields={[
        { label: '客户', value: record.customerName || '-' },
        { label: '工时', value: `${Number(record.actualTime).toFixed(1)}h` },
        { label: '记录人', value: record.ownerName || '-' },
        {
          label: '类型',
          value: record.workType
            ? (EFFORT_WORK_TYPE_LABELS[record.workType as EffortWorkTypeValue] ?? record.workType)
            : '-',
        },
      ]}
      footer={
        record.startDate
          ? `开始日期: ${new Date(record.startDate).toLocaleDateString('zh-CN')}`
          : undefined
      }
      onClick={() => crud.openViewDialog(record)}
      testId={`effort-record-${record.id}`}
    />
  );

  return (
    <StandardLayout
      toolbar={
        <StandardToolbar
          bulkSelection={{
            selectedCount: crud.selectedKeys.size,
            onClearSelection: crud.clearSelection,
            onBulkDelete: crud.openBulkDeleteDialog,
          }}
          onSearch={() => {
            filter.search();
            setTimeout(() => crud.refresh(), 0);
          }}
          onReset={() => {
            filter.reset();
            setTimeout(() => crud.refresh(), 0);
          }}
          actions={
            <div className="flex items-center gap-2">
              {hasWorkDateField && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={applyThisWeek}
                  title="将工时日期重置为本周一到周日"
                >
                  <CalendarRange className="mr-1 h-4 w-4" />
                  本周
                </Button>
              )}
              <ColumnVisibilityDropdown
                columns={columnVisibility.columns}
                onToggle={columnVisibility.toggleColumn}
                onShowAll={columnVisibility.showAll}
                onResetVisibility={columnVisibility.resetToDefault}
                onReorder={columnVisibility.reorderColumns}
                currentSortBy={crud.sorting.sortBy}
                currentSortOrder={crud.sorting.sortOrder}
                onServerSortingVersionApplied={crud.sorting.markServerSortingVersionApplied}
              />
            </div>
          }
          filters={
            scheme.isLoading ? (
              <FilterBarSkeleton count={5} />
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
        actions={rowActions}
        loading={crud.loading}
        sorting={crud.sorting}
        onRowClick={crud.openViewDialog}
        renderMobileCard={renderMobileCard}
        rowSelection={crud.rowSelectionProps}
        columnVisibility={{
          columns: columnVisibility.columns,
          onToggle: columnVisibility.toggleColumn,
          onShowAll: columnVisibility.showAll,
        }}
        hidePagination
        emptyState={{
          title: '暂无工时记录',
          description: '在"我的填报"标签页中添加工时记录',
          icon: <Clock className="h-12 w-12 text-muted-foreground/50" />,
        }}
      />
      {crud.data.length > 0 && (
        <div className="flex items-center justify-end px-4 py-2 text-sm text-muted-foreground">
          <span>
            当前页合计:{' '}
            <span className="font-medium text-foreground">
              {crud.data.reduce((sum, item) => sum + Number(item.actualTime || 0), 0).toFixed(1)}{' '}
              小时
            </span>
          </span>
        </div>
      )}

      <FormDialog
        {...crud.formDialogProps}
        variant="drawer"
        title={crud.isEditing ? '工时详情' : '新建工时'}
        onSubmit={crud.handleSubmit}
      >
        <div className="col-span-1 space-y-6 py-4 md:col-span-2">
          <div className={cn('grid gap-4', !isMobile && 'grid-cols-2')}>
            {/* 记录人 - 非管理员始终只读 */}
            {canSeeAllRecords ? (
              <FormField
                name="ownerId"
                label="记录人"
                error={crud.getFieldError('ownerId')}
                viewContent={crud.editingEntity?.ownerName}
              >
                <EmployeeSelect
                  value={crud.formData.ownerId ?? ''}
                  onChange={(v) => crud.updateFormField('ownerId', v || null)}
                  placeholder="搜索并选择记录人"
                />
              </FormField>
            ) : (
              <FormField
                name="ownerId"
                label="记录人"
                forceView
                viewContent={
                  crud.editingEntity?.ownerName || user?.employee?.name || user?.username
                }
              />
            )}

            {/* 项目 */}
            <FormField
              name="projectId"
              label="项目"
              required
              error={crud.getFieldError('projectId')}
              viewContent={crud.editingEntity?.projectName}
            >
              <ProjectSelect
                value={crud.formData.projectId}
                onChange={(val) => crud.updateFormField('projectId', val)}
                disabled={crud.isViewMode}
              />
            </FormField>

            {/* 实际工时 */}
            <FormField
              name="actualTime"
              label={crud.isViewMode ? '实际工时' : '实际工时(h)'}
              required
              error={crud.getFieldError('actualTime')}
              viewContent={`${Number(crud.formData.actualTime).toFixed(1)}h`}
            >
              <Input
                id="actualTime"
                type="number"
                step="0.1"
                min="0"
                placeholder="请输入实际工时"
                value={String(crud.formData.actualTime)}
                onChange={(e) =>
                  crud.updateFormField('actualTime', e.target.value ? Number(e.target.value) : 0)
                }
              />
            </FormField>

            {/* 工时类型 */}
            <FormField
              name="workType"
              label="工时类型"
              error={crud.getFieldError('workType')}
              viewContent={
                crud.formData.workType
                  ? (EFFORT_WORK_TYPE_LABELS[crud.formData.workType as EffortWorkTypeValue] ??
                    crud.formData.workType)
                  : undefined
              }
            >
              <WorkTypeSelect
                value={crud.formData.workType ?? null}
                onChange={(val) => crud.updateFormField('workType', val)}
              />
            </FormField>

            {/* 开始日期 */}
            <FormField
              name="startDate"
              label="开始日期"
              error={crud.getFieldError('startDate')}
              viewContent={formatDateDisplay(crud.formData.startDate) || undefined}
            >
              <DatePicker
                date={parseLocalDateString(crud.formData.startDate?.slice(0, 10))}
                onDateChange={(d) =>
                  crud.updateFormField('startDate', d ? formatDateToLocalDateString(d) : null)
                }
                className="w-full"
              />
            </FormField>

            {/* 结束日期 */}
            <FormField
              name="endDate"
              label="结束日期"
              error={crud.getFieldError('endDate')}
              viewContent={formatDateDisplay(crud.formData.endDate) || undefined}
            >
              <DatePicker
                date={parseLocalDateString(crud.formData.endDate?.slice(0, 10))}
                onDateChange={(d) =>
                  crud.updateFormField('endDate', d ? formatDateToLocalDateString(d) : null)
                }
                className="w-full"
              />
            </FormField>
          </div>

          {/* 描述 - 单独一行 */}
          <FormField
            name="description"
            label="描述"
            error={crud.getFieldError('description')}
            viewContent={crud.formData.description}
          >
            <Textarea
              id="description"
              placeholder="请输入工时描述"
              rows={3}
              value={crud.formData.description ?? ''}
              onChange={(e) => crud.updateFormField('description', e.target.value)}
            />
          </FormField>
        </div>
      </FormDialog>

      <DeleteConfirm {...crud.deleteConfirmProps} />
      <BulkDeleteConfirm {...crud.bulkDeleteConfirmProps} />
    </StandardLayout>
  );
}
