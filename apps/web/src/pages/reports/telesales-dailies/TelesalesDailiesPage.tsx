/**
 * 电销日报页（电销专员专用入口）
 * ------------------------------------------------------------------
 * 与 work-dailies 共表 (CrmWorkDaily)、共后端接口 (/crm-work-dailies)、独立权限 (reports.telesales_dailies)，
 * 唯一区别：
 *  - 字段精简：只露出与电话外呼相关的字段（日期/提交人/通话指标/新增联系方式/附件/备注），
 *    隐藏 CRM 销售要填的 reportType/重点客户总结/拜访计划/拜访客户数等。
 *  - reportType 锁定为 'telesales'：创建时硬写、列表时硬过滤。
 *  - 权限校验使用 reports.telesales_dailies；后端与 CRM 日报接口共享但支持任一日报权限。
 *
 * 电销专员的工作机外呼需登记 CRM，管理侧要的核心是
 * 「拨打多少 + 时长多少 + 附工作机截图」的日报形态。
 */
// 触发内置渲染器注册（副作用 import）
import '@/lib/column-renderers';

import { crmWorkDailyResponseSchema } from '@ky-azeroth/shared/schemas/crm-work-daily';
import { Plus } from 'lucide-react';
import { useMemo } from 'react';

import { MobileBottomBar, MobileBottomBarSpacer } from '@/components/mobile';
import { BulkDeleteConfirm } from '@/components/patterns/bulk-delete-confirm';
import { ColumnVisibilityDropdown } from '@/components/patterns/column-visibility';
import { CrudTable } from '@/components/patterns/crud-table';
import { DeleteConfirm } from '@/components/patterns/delete-confirm';
import { EmployeeSelect } from '@/components/patterns/employee-select';
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
import { Textarea } from '@/components/ui/textarea';
import { useColumnVisibility } from '@/hooks/use-column-visibility';
import { useCrud } from '@/hooks/use-crud';
import { useFileUpload } from '@/hooks/use-file-upload';
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

// 复用 work-dailies 的类型/转换器，避免重复造轮子
import {
  type CrmWorkDailyFormData,
  crmWorkDailyFormSchema,
  type CrmWorkDailyProfile,
  toCrmWorkDailyFormData,
  toCrmWorkDailyPayload,
  toCrmWorkDailyProfile,
} from '../work-dailies/types';

/** 电销日报固定 reportType */
const TELESALES_REPORT_TYPE = 'telesales' as const;

function renderMultilineText(text: string | null | undefined) {
  if (!text) return undefined;
  return <span className="w-full whitespace-pre-wrap break-words text-left">{text}</span>;
}

/** 附件字段（view 模式绕开 FormField viewContent 壳子，参考 visit-records 写法） */
function TelesalesAttachmentsField({
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
        <Label>工作机截图 / 附件</Label>
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
    <FormField name="attachments" label="工作机截图 / 附件" fullRow error={error}>
      <MultiFileUpload
        value={value ?? []}
        onChange={(files) => onChange(files.length > 0 ? files : null)}
        onUpload={onUpload ?? (() => Promise.reject(new Error('no-upload-handler')))}
      />
    </FormField>
  );
}

const TELESALES_COLUMN_CONFIG = [
  { key: 'reportDate', label: '日报日期', visible: true, canHide: false },
  { key: 'senderName', label: '提交人', visible: true },
  { key: 'submitStatus', label: '提交状态', visible: true },
  { key: 'callsMadeCount', label: '拨打电话', visible: true },
  { key: 'callsConnectedCount', label: '接通电话', visible: true },
  { key: 'callsOver30sCount', label: '三十秒+', visible: true },
  { key: 'totalCallMinutes', label: '总时长(分)', visible: true },
  { key: 'newContactMethodCount', label: '新增联系方式', visible: true },
  { key: 'attachments', label: '截图', visible: true },
  { key: 'remark', label: '备注', visible: false },
  { key: 'status', label: '记录状态', visible: false },
  { key: 'createdAt', label: '录入时间', visible: true },
];

export function TelesalesDailiesPage() {
  const isMobile = useIsMobile();
  const user = useAuthStore((state) => state.user);
  const hasMenuPermission = useAuthStore((state) => state.hasMenuPermission);
  // 电销日报独立权限（底层仍与 CRM 日报同表同接口）。
  const canCreate = hasMenuPermission('reports', 'telesales_dailies', 'create');
  const canEdit = hasMenuPermission('reports', 'telesales_dailies', 'edit');
  const canDelete = hasMenuPermission('reports', 'telesales_dailies', 'delete');
  const currentEmployeeId = user?.employee?.id ?? user?.id ?? null;

  const { uploadFile } = useFileUpload();

  /** 电销日报固定字段：reportType=telesales，无关字段全部置 null 不再露给用户 */
  const buildInitialFormData = (): CrmWorkDailyFormData => ({
    reportDate: getTodayDateString(),
    reportType: TELESALES_REPORT_TYPE,
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
  });

  const crud = useCrud<CrmWorkDailyProfile, CrmWorkDailyFormData>({
    endpoint: '/crm-work-dailies',
    schema: crmWorkDailyFormSchema,
    validateMode: 'onSubmit',
    initialFormData: buildInitialFormData(),
    entityToForm: toCrmWorkDailyFormData,
    /** 提交时强制锁定 reportType=telesales，防止经由 view→edit 路径残留其他类型 */
    formToPayload: (form) => toCrmWorkDailyPayload({ ...form, reportType: TELESALES_REPORT_TYPE }),
    transformData: (items) => items.map(toCrmWorkDailyProfile),
    getEntityName: (entity) => formatDateDisplay(entity.reportDate) || entity.id,
    disableEdit: !canEdit,
    disableDelete: !canDelete,
    paginationOptions: {
      initialSortBy: 'createdAt',
      initialSortOrder: 'desc',
      // 列表只查电销日报；与 CRM 日报视图天然隔离
      extraParams: { reportType: TELESALES_REPORT_TYPE },
    },
  });

  const columnVisibility = useColumnVisibility(TELESALES_COLUMN_CONFIG, {
    onServerSortingApplied: crud.sorting.applyServerSorting,
  });

  const getStatusBadge = (status: string | null) => {
    if (!status) return <span className="text-muted-foreground">-</span>;
    const label = getStatusLabel(status, workDailyStatusMap);
    const color = getStatusColor(status, workDailyStatusMap);
    return <Badge className={cn(color, `hover:${color}`)}>{label}</Badge>;
  };

  const columns = useMemo(
    () =>
      deriveColumnsFromSchema<CrmWorkDailyProfile>(crmWorkDailyResponseSchema, {
        // 白名单：电销页严格只允许这些列出现在表格与列设置下拉里，
        // 防止「列设置」里把 CRM 销售特有列（重点客户总结/拜访计划/报告类型 等）勾出来。
        include: TELESALES_COLUMN_CONFIG.map((c) => c.key),
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
            key: 'newContactMethodCount',
            render: (item) =>
              item.newContactMethodCount !== null ? `${item.newContactMethodCount}` : '-',
          },
          {
            key: 'attachments',
            render: (item) => {
              const count = item.attachments?.length ?? 0;
              return count > 0 ? `${count} 张` : '-';
            },
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
        { label: '拨打电话', value: item.callsMadeCount !== null ? `${item.callsMadeCount}` : '-' },
        {
          label: '接通电话',
          value: item.callsConnectedCount !== null ? `${item.callsConnectedCount}` : '-',
        },
        {
          label: '三十秒+',
          value: item.callsOver30sCount !== null ? `${item.callsOver30sCount}` : '-',
        },
        {
          label: '总时长(分)',
          value: item.totalCallMinutes !== null ? `${item.totalCallMinutes}` : '-',
        },
        {
          label: '新增联系方式',
          value: item.newContactMethodCount !== null ? `${item.newContactMethodCount}` : '-',
        },
        {
          label: '截图',
          value:
            item.attachments && item.attachments.length > 0 ? `${item.attachments.length} 张` : '-',
        },
      ]}
      onClick={() => crud.openViewDialog(item)}
      testId={`telesales-daily-${item.id}`}
    />
  );

  return (
    <MobileBottomBarSpacer hasBottomBar={isMobile}>
      <StandardLayout
        toolbar={
          <StandardToolbar
            onCreate={canCreate ? crud.openCreateDialog : undefined}
            createLabel="新建电销日报"
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
            title: '暂无电销日报',
            description: '点击"新建电销日报"添加第一条记录',
          }}
        />

        <FormDialog
          {...crud.formDialogProps}
          variant="drawer"
          title={crud.isEditing ? '电销日报详情' : '新建电销日报'}
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
                label="三十秒+"
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

            <TelesalesAttachmentsField
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
                placeholder="可备注：工作机型号、未接通原因、当日异常等"
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
            新建电销日报
          </Button>
        </MobileBottomBar>
      )}
    </MobileBottomBarSpacer>
  );
}
