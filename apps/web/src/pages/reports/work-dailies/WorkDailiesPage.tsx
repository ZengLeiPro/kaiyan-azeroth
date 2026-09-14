// 触发内置渲染器注册（副作用 import）
import '@/lib/column-renderers';

import { WORK_DAILY_REPORT_TYPE_LABELS } from '@ky-azeroth/shared/constants/status-labels';
import { crmWorkDailyResponseSchema } from '@ky-azeroth/shared/schemas/crm-work-daily';
import { Plus } from 'lucide-react';
import { useMemo } from 'react';

import { MobileBottomBar, MobileBottomBarSpacer } from '@/components/mobile';
import { BulkDeleteConfirm } from '@/components/patterns/bulk-delete-confirm';
import { ColumnVisibilityDropdown } from '@/components/patterns/column-visibility';
import { CrudFilterBar } from '@/components/patterns/crud-filter-bar';
import { CrudTable } from '@/components/patterns/crud-table';
import { DeleteConfirm } from '@/components/patterns/delete-confirm';
import { EmployeeSelect } from '@/components/patterns/employee-select';
import { FilterBarSkeleton } from '@/components/patterns/filter-bar-skeleton';
import { FormDialog } from '@/components/patterns/form-dialog';
import { FormField, useFormMode } from '@/components/patterns/form-field';
import { GenericMobileCard } from '@/components/patterns/generic-mobile-card';
import { MultiFileUpload } from '@/components/patterns/multi-file-upload';
import { createStandardActions } from '@/components/patterns/row-actions-helpers';
import { StandardToolbar } from '@/components/patterns/standard-toolbar';
import { StandardLayout } from '@/components/templates/standard-layout';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DatePicker } from '@/components/ui/date-picker';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useColumnVisibility } from '@/hooks/use-column-visibility';
import { useCrud } from '@/hooks/use-crud';
import { useFileUpload } from '@/hooks/use-file-upload';
import { useFilterScheme } from '@/hooks/use-filter-scheme';
import { useManualFilter } from '@/hooks/use-manual-filter';
import { useIsMobile } from '@/hooks/use-mobile';
import { deriveColumnsFromSchema } from '@/lib/columns-from-schema';
import {
  formatDateDisplay,
  formatDateToLocalDateString,
  getTodayDateString,
  parseLocalDateString,
} from '@/lib/date-utils';
import { getStatusColor, getStatusLabel, workDailyStatusMap } from '@/lib/status-maps';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/stores/auth';

import {
  type CrmWorkDailyFormData,
  crmWorkDailyFormSchema,
  type CrmWorkDailyProfile,
  toCrmWorkDailyFormData,
  toCrmWorkDailyPayload,
  toCrmWorkDailyProfile,
} from './types';

function renderTruncatedText(text: string | null | undefined) {
  if (!text) return '-';
  return (
    <span className="line-clamp-1" title={text}>
      {text}
    </span>
  );
}

function renderMultilineText(text: string | null | undefined) {
  if (!text) return undefined;
  return <span className="w-full whitespace-pre-wrap break-words text-left">{text}</span>;
}

/**
 * 日报附件字段：电销外呼日报场景下，提交人上传工作机外呼截图作为动作证据。
 * 走法对齐 visit-records/visit-record-fields.tsx 的 AttachmentsField：
 * - view 模式绕开 FormField 的 viewContent 壳子（min-h-[40px] + inline flex 会压扁块级控件），
 *   直接画 Label + 只读 MultiFileUpload。
 * - 与拜访记录不同：日报附件 **非必填**（非电销场景不强求）。
 */
function WorkDailyAttachmentsField({
  value,
  onChange,
  onUpload,
  error,
}: {
  value: CrmWorkDailyFormData['attachments'];
  onChange: (files: CrmWorkDailyFormData['attachments']) => void;
  onUpload?: ReturnType<typeof useFileUpload>['uploadFile'];
  error?: string;
}) {
  const { mode } = useFormMode();
  const isView = mode === 'view';

  if (isView) {
    return (
      <div className="col-span-1 space-y-2 md:col-span-2">
        <Label>附件</Label>
        <MultiFileUpload
          value={value ?? []}
          onChange={() => {}}
          onUpload={() => Promise.reject(new Error('view-mode'))}
          readOnly
        />
      </div>
    );
  }

  return (
    <FormField name="attachments" label="附件" fullRow error={error}>
      <MultiFileUpload
        value={value ?? []}
        onChange={(files) => onChange(files.length > 0 ? files : null)}
        onUpload={onUpload ?? (() => Promise.reject(new Error('no-upload-handler')))}
      />
    </FormField>
  );
}

const WORK_DAILY_COLUMN_CONFIG = [
  { key: 'reportDate', label: '日报日期', visible: true, canHide: false },
  { key: 'senderName', label: '提交人', visible: true },
  { key: 'reportType', label: '报告类型', visible: true },
  { key: 'submitStatus', label: '提交状态', visible: true },
  { key: 'callsMadeCount', label: '拨打电话', visible: true },
  { key: 'callsConnectedCount', label: '接通电话', visible: true },
  { key: 'callsOver30sCount', label: '三十秒', visible: true },
  { key: 'totalCallMinutes', label: '总时长(分)', visible: true },
  { key: 'visitCustomerCount', label: '拜访客户', visible: true },
  { key: 'newCustomerCount', label: '新增客户', visible: true },
  { key: 'newContactMethodCount', label: '新增联系方式', visible: true },
  { key: 'attachments', label: '附件', visible: true },
  { key: 'keyCustomerSummary', label: '重点客户总结', visible: false },
  { key: 'tomorrowVisitPlan', label: '明日拜访计划', visible: false },
  { key: 'otherPlanArrangements', label: '其他计划安排', visible: false },
  { key: 'coordinationItems', label: '协调事项', visible: false },
  { key: 'remark', label: '备注', visible: false },
  { key: 'status', label: '记录状态', visible: false },
  { key: 'createdAt', label: '录入时间', visible: true },
];

/**
 * 报告类型选项（与筛选栏无关，保留给 form Select 与移动卡片）。
 * 来源：shared WORK_DAILY_REPORT_TYPE / WORK_DAILY_REPORT_TYPE_LABELS。
 * 筛选栏的 options 从 useFilterScheme 的 registry 元数据动态生成。
 */
const reportTypeOptions = Object.entries(WORK_DAILY_REPORT_TYPE_LABELS).map(([value, label]) => ({
  value,
  label,
}));

export function WorkDailiesPage() {
  const isMobile = useIsMobile();
  const user = useAuthStore((state) => state.user);
  const hasMenuPermission = useAuthStore((state) => state.hasMenuPermission);
  const canCreate = hasMenuPermission('reports', 'work_dailies', 'create');
  const canEdit = hasMenuPermission('reports', 'work_dailies', 'edit');
  const canDelete = hasMenuPermission('reports', 'work_dailies', 'delete');
  // push 6 后 user.id === employee.id；保留 employee.id 作为首选，user.id 兜底更稳
  const currentEmployeeId = user?.employee?.id ?? user?.id ?? null;

  const { uploadFile } = useFileUpload();

  // 筛选字段 + 初始 state 全由服务端的 filter-scheme registry/config 驱动。
  const scheme = useFilterScheme('reports.work_dailies');
  const filter = useManualFilter(scheme.initialFilters, undefined, scheme.version);

  const crud = useCrud<CrmWorkDailyProfile, CrmWorkDailyFormData>({
    endpoint: '/crm-work-dailies',
    schema: crmWorkDailyFormSchema,
    validateMode: 'onSubmit',
    initialFormData: {
      reportDate: getTodayDateString(),
      reportType: 'daily',
      submitStatus: null,
      senderId: currentEmployeeId,
      keyCustomerSummary: null,
      tomorrowVisitPlan: null,
      otherPlanArrangements: null,
      coordinationItems: null,
      callsMadeCount: null,
      callsConnectedCount: null,
      callsOver30sCount: null,
      totalCallMinutes: null,
      visitCustomerCount: null,
      newCustomerCount: null,
      newContactMethodCount: null,
      attachments: null,
      remark: null,
    },
    entityToForm: toCrmWorkDailyFormData,
    formToPayload: toCrmWorkDailyPayload,
    transformData: (items) => items.map(toCrmWorkDailyProfile),
    getEntityName: (entity) => formatDateDisplay(entity.reportDate) || entity.id,
    disableEdit: !canEdit,
    disableDelete: !canDelete,
    paginationOptions: {
      initialSortBy: 'createdAt',
      initialSortOrder: 'desc',
      extraParams: filter.apiParams,
    },
  });

  const columnVisibility = useColumnVisibility(WORK_DAILY_COLUMN_CONFIG, {
    onServerSortingApplied: crud.sorting.applyServerSorting,
  });

  const getStatusBadge = (status: string | null) => {
    if (!status) return <span className="text-muted-foreground">-</span>;
    const label = getStatusLabel(status, workDailyStatusMap);
    const color = getStatusColor(status, workDailyStatusMap);
    return <Badge className={cn(color, `hover:${color}`)}>{label}</Badge>;
  };

  /**
   * 表格列：从 schema 派生；reportType/submitStatus 走 schema statusBadge 自动渲染。
   * 复杂 render 通过 overrides 保留：
   * - 数值列与附件列显示 null vs 数值/计数
   * - 多个长文本列统一 line-clamp 截断
   */
  const columns = useMemo(
    () =>
      deriveColumnsFromSchema<CrmWorkDailyProfile>(crmWorkDailyResponseSchema, {
        overrides: [
          {
            key: 'reportDate',
            render: (item) => formatDateDisplay(item.reportDate) || '-',
          },
          {
            key: 'callsMadeCount',
            render: (item) => (item.callsMadeCount !== null ? `${item.callsMadeCount}` : '-'),
          },
          {
            key: 'callsConnectedCount',
            render: (item) =>
              item.callsConnectedCount !== null ? `${item.callsConnectedCount}` : '-',
          },
          {
            key: 'callsOver30sCount',
            render: (item) => (item.callsOver30sCount !== null ? `${item.callsOver30sCount}` : '-'),
          },
          {
            key: 'totalCallMinutes',
            render: (item) => (item.totalCallMinutes !== null ? `${item.totalCallMinutes}` : '-'),
          },
          {
            key: 'visitCustomerCount',
            render: (item) =>
              item.visitCustomerCount !== null ? `${item.visitCustomerCount}` : '-',
          },
          {
            key: 'newCustomerCount',
            render: (item) => (item.newCustomerCount !== null ? `${item.newCustomerCount}` : '-'),
          },
          {
            key: 'newContactMethodCount',
            render: (item) =>
              item.newContactMethodCount !== null ? `${item.newContactMethodCount}` : '-',
          },
          {
            key: 'attachments',
            render: (item) => {
              const count = item.attachments?.length ?? 0;
              return count > 0 ? `${count} 个` : '-';
            },
          },
          {
            key: 'keyCustomerSummary',
            render: (item) => renderTruncatedText(item.keyCustomerSummary),
          },
          {
            key: 'tomorrowVisitPlan',
            render: (item) => renderTruncatedText(item.tomorrowVisitPlan),
          },
          {
            key: 'otherPlanArrangements',
            render: (item) => renderTruncatedText(item.otherPlanArrangements),
          },
          {
            key: 'coordinationItems',
            render: (item) => renderTruncatedText(item.coordinationItems),
          },
          {
            key: 'remark',
            render: (item) => renderMultilineText(item.remark) ?? '-',
          },
        ],
      }),
    []
  );

  const rowActions = useMemo(
    () =>
      createStandardActions<CrmWorkDailyProfile>({
        onView: crud.openViewDialog,
        onEdit: crud.openEditDialog,
        onDelete: crud.openDeleteDialog,
        hideEdit: !canEdit,
        hideDelete: !canDelete,
      }),
    [crud.openViewDialog, crud.openEditDialog, crud.openDeleteDialog, canEdit, canDelete]
  );

  const renderMobileCard = (item: CrmWorkDailyProfile) => (
    <GenericMobileCard
      title={`${formatDateDisplay(item.reportDate) || '未知日期'} - ${item.senderName || '未知'}`}
      status={getStatusBadge(item.submitStatus)}
      fields={[
        {
          label: '报告类型',
          value:
            reportTypeOptions.find((o) => o.value === item.reportType)?.label ||
            item.reportType ||
            '-',
        },
        { label: '拨打电话', value: item.callsMadeCount !== null ? `${item.callsMadeCount}` : '-' },
        {
          label: '接通电话',
          value: item.callsConnectedCount !== null ? `${item.callsConnectedCount}` : '-',
        },
        {
          label: '三十秒',
          value: item.callsOver30sCount !== null ? `${item.callsOver30sCount}` : '-',
        },
        {
          label: '总时长(分)',
          value: item.totalCallMinutes !== null ? `${item.totalCallMinutes}` : '-',
        },
        {
          label: '拜访客户',
          value: item.visitCustomerCount !== null ? `${item.visitCustomerCount}` : '-',
        },
        {
          label: '新增客户',
          value: item.newCustomerCount !== null ? `${item.newCustomerCount}` : '-',
        },
        {
          label: '新增联系方式',
          value: item.newContactMethodCount !== null ? `${item.newContactMethodCount}` : '-',
        },
      ]}
      onClick={() => crud.openViewDialog(item)}
      testId={`work-daily-${item.id}`}
    />
  );

  return (
    <MobileBottomBarSpacer hasBottomBar={isMobile}>
      <StandardLayout
        toolbar={
          <StandardToolbar
            onCreate={canCreate ? crud.openCreateDialog : undefined}
            createLabel="新建日报"
            onSearch={filter.search}
            onReset={filter.reset}
            actions={
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
            }
            bulkSelection={{
              selectedCount: crud.selectedKeys.size,
              onClearSelection: crud.clearSelection,
              onBulkDelete: crud.openBulkDeleteDialog,
            }}
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
          loading={crud.loading}
          sorting={crud.sorting}
          actions={rowActions}
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
            title: '暂无工作日报',
            description: '点击"新建日报"添加第一条记录',
          }}
        />

        <FormDialog
          {...crud.formDialogProps}
          variant="drawer"
          title={crud.isEditing ? '日报详情' : '新建日报'}
          onSubmit={crud.handleSubmit}
        >
          <>
            <FormField
              name="reportDate"
              label="日报日期"
              error={crud.getFieldError('reportDate')}
              viewContent={crud.formData.reportDate}
            >
              <DatePicker
                date={parseLocalDateString(crud.formData.reportDate)}
                onDateChange={(d) =>
                  crud.updateFormField('reportDate', d ? formatDateToLocalDateString(d) : null)
                }
                className="w-full"
              />
            </FormField>

            <FormField
              name="reportType"
              label="报告类型"
              error={crud.getFieldError('reportType')}
              viewContent={
                reportTypeOptions.find((o) => o.value === crud.formData.reportType)?.label ||
                crud.formData.reportType
              }
            >
              <Select
                options={[{ value: '', label: '请选择' }, ...reportTypeOptions]}
                value={crud.formData.reportType || ''}
                onValueChange={(v) => crud.updateFormField('reportType', v || null)}
              />
            </FormField>

            <FormField
              name="senderId"
              label="提交人"
              error={crud.getFieldError('senderId')}
              viewContent={crud.editingEntity?.senderName}
            >
              <EmployeeSelect
                value={crud.formData.senderId ?? ''}
                onChange={(v) => crud.updateFormField('senderId', v || null)}
                placeholder="搜索并选择提交人"
              />
            </FormField>

            <FormField
              name="keyCustomerSummary"
              label="重点客户总结"
              fullRow
              error={crud.getFieldError('keyCustomerSummary')}
              viewContent={renderMultilineText(crud.formData.keyCustomerSummary)}
            >
              <Textarea
                id="keyCustomerSummary"
                placeholder="请输入重点客户总结"
                rows={3}
                value={crud.formData.keyCustomerSummary || ''}
                onChange={(e) => crud.updateFormField('keyCustomerSummary', e.target.value || null)}
              />
            </FormField>

            <FormField
              name="tomorrowVisitPlan"
              label="明日拜访计划"
              fullRow
              error={crud.getFieldError('tomorrowVisitPlan')}
              viewContent={renderMultilineText(crud.formData.tomorrowVisitPlan)}
            >
              <Textarea
                id="tomorrowVisitPlan"
                placeholder="请输入明日拜访计划"
                rows={3}
                value={crud.formData.tomorrowVisitPlan || ''}
                onChange={(e) => crud.updateFormField('tomorrowVisitPlan', e.target.value || null)}
              />
            </FormField>

            <FormField
              name="otherPlanArrangements"
              label="其他计划安排"
              fullRow
              error={crud.getFieldError('otherPlanArrangements')}
              viewContent={renderMultilineText(crud.formData.otherPlanArrangements)}
            >
              <Textarea
                id="otherPlanArrangements"
                placeholder="请输入其他计划安排"
                rows={3}
                value={crud.formData.otherPlanArrangements || ''}
                onChange={(e) =>
                  crud.updateFormField('otherPlanArrangements', e.target.value || null)
                }
              />
            </FormField>

            <FormField
              name="coordinationItems"
              label="协调事项"
              fullRow
              error={crud.getFieldError('coordinationItems')}
              viewContent={renderMultilineText(crud.formData.coordinationItems)}
            >
              <Textarea
                id="coordinationItems"
                placeholder="请输入协调事项"
                rows={3}
                value={crud.formData.coordinationItems || ''}
                onChange={(e) => crud.updateFormField('coordinationItems', e.target.value || null)}
              />
            </FormField>

            <div className={cn('col-span-1 grid gap-4 md:col-span-2', !isMobile && 'grid-cols-2')}>
              <FormField
                name="callsMadeCount"
                label="拨打电话数"
                error={crud.getFieldError('callsMadeCount')}
                viewContent={
                  crud.formData.callsMadeCount !== null
                    ? `${crud.formData.callsMadeCount}`
                    : undefined
                }
              >
                <Input
                  id="callsMadeCount"
                  type="number"
                  placeholder="0"
                  value={crud.formData.callsMadeCount ?? ''}
                  onChange={(e) =>
                    crud.updateFormField(
                      'callsMadeCount',
                      e.target.value ? Number(e.target.value) : null
                    )
                  }
                />
              </FormField>

              <FormField
                name="callsConnectedCount"
                label="接通电话数"
                error={crud.getFieldError('callsConnectedCount')}
                viewContent={
                  crud.formData.callsConnectedCount !== null
                    ? `${crud.formData.callsConnectedCount}`
                    : undefined
                }
              >
                <Input
                  id="callsConnectedCount"
                  type="number"
                  placeholder="0"
                  value={crud.formData.callsConnectedCount ?? ''}
                  onChange={(e) =>
                    crud.updateFormField(
                      'callsConnectedCount',
                      e.target.value ? Number(e.target.value) : null
                    )
                  }
                />
              </FormField>

              <FormField
                name="callsOver30sCount"
                label="三十秒"
                error={crud.getFieldError('callsOver30sCount')}
                viewContent={
                  crud.formData.callsOver30sCount !== null
                    ? `${crud.formData.callsOver30sCount}`
                    : undefined
                }
              >
                <Input
                  id="callsOver30sCount"
                  type="number"
                  placeholder="0"
                  value={crud.formData.callsOver30sCount ?? ''}
                  onChange={(e) =>
                    crud.updateFormField(
                      'callsOver30sCount',
                      e.target.value ? Number(e.target.value) : null
                    )
                  }
                />
              </FormField>

              <FormField
                name="totalCallMinutes"
                label="总时长(分钟)"
                error={crud.getFieldError('totalCallMinutes')}
                viewContent={
                  crud.formData.totalCallMinutes !== null
                    ? `${crud.formData.totalCallMinutes}`
                    : undefined
                }
              >
                <Input
                  id="totalCallMinutes"
                  type="number"
                  placeholder="0"
                  value={crud.formData.totalCallMinutes ?? ''}
                  onChange={(e) =>
                    crud.updateFormField(
                      'totalCallMinutes',
                      e.target.value ? Number(e.target.value) : null
                    )
                  }
                />
              </FormField>

              <FormField
                name="visitCustomerCount"
                label="拜访客户数"
                error={crud.getFieldError('visitCustomerCount')}
                viewContent={
                  crud.formData.visitCustomerCount !== null
                    ? `${crud.formData.visitCustomerCount}`
                    : undefined
                }
              >
                <Input
                  id="visitCustomerCount"
                  type="number"
                  placeholder="0"
                  value={crud.formData.visitCustomerCount ?? ''}
                  onChange={(e) =>
                    crud.updateFormField(
                      'visitCustomerCount',
                      e.target.value ? Number(e.target.value) : null
                    )
                  }
                />
              </FormField>

              <FormField
                name="newCustomerCount"
                label="新增客户数"
                error={crud.getFieldError('newCustomerCount')}
                viewContent={
                  crud.formData.newCustomerCount !== null
                    ? `${crud.formData.newCustomerCount}`
                    : undefined
                }
              >
                <Input
                  id="newCustomerCount"
                  type="number"
                  placeholder="0"
                  value={crud.formData.newCustomerCount ?? ''}
                  onChange={(e) =>
                    crud.updateFormField(
                      'newCustomerCount',
                      e.target.value ? Number(e.target.value) : null
                    )
                  }
                />
              </FormField>

              <FormField
                name="newContactMethodCount"
                label="新增联系方式"
                error={crud.getFieldError('newContactMethodCount')}
                viewContent={
                  crud.formData.newContactMethodCount !== null
                    ? `${crud.formData.newContactMethodCount}`
                    : undefined
                }
              >
                <Input
                  id="newContactMethodCount"
                  type="number"
                  placeholder="0"
                  value={crud.formData.newContactMethodCount ?? ''}
                  onChange={(e) =>
                    crud.updateFormField(
                      'newContactMethodCount',
                      e.target.value ? Number(e.target.value) : null
                    )
                  }
                />
              </FormField>
            </div>

            <WorkDailyAttachmentsField
              value={crud.formData.attachments ?? null}
              onChange={(v) => crud.updateFormField('attachments', v)}
              onUpload={uploadFile}
              error={crud.getFieldError('attachments')}
            />

            <FormField
              name="remark"
              label="备注"
              fullRow
              error={crud.getFieldError('remark')}
              viewContent={renderMultilineText(crud.formData.remark)}
            >
              <Textarea
                id="remark"
                placeholder="请输入备注"
                rows={3}
                value={crud.formData.remark || ''}
                onChange={(e) => crud.updateFormField('remark', e.target.value || null)}
              />
            </FormField>
          </>
        </FormDialog>

        <DeleteConfirm {...crud.deleteConfirmProps} />
        <BulkDeleteConfirm {...crud.bulkDeleteConfirmProps} />
      </StandardLayout>
      {isMobile && canCreate && (
        <MobileBottomBar>
          <Button className="flex-1" onClick={crud.openCreateDialog}>
            <Plus className="mr-2 h-4 w-4" />
            新建日报
          </Button>
        </MobileBottomBar>
      )}
    </MobileBottomBarSpacer>
  );
}
