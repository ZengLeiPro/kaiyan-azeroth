// 触发内置渲染器/导出格式化器注册（副作用 import）
import '@/lib/column-export-formatters';
import '@/lib/column-renderers';

import { payrollResponseSchema } from '@ky-azeroth/shared/schemas/payroll';
import type { IPayrollResponse } from '@ky-azeroth/shared/types/payroll';
import { Plus } from 'lucide-react';
import { useMemo } from 'react';

import { MobileBottomBar, MobileBottomBarSpacer } from '@/components/mobile';
import { BulkDeleteConfirm } from '@/components/patterns/bulk-delete-confirm';
import { ColumnVisibilityDropdown } from '@/components/patterns/column-visibility';
import { CrudFilterBar } from '@/components/patterns/crud-filter-bar';
import { CrudTable } from '@/components/patterns/crud-table';
import { DeleteConfirm } from '@/components/patterns/delete-confirm';
import { DepartmentSelect } from '@/components/patterns/department-select';
import { EmployeeSelect } from '@/components/patterns/employee-select';
import { FilterBarSkeleton } from '@/components/patterns/filter-bar-skeleton';
import { FormDialog } from '@/components/patterns/form-dialog';
import { FormField } from '@/components/patterns/form-field';
import { GenericMobileCard } from '@/components/patterns/generic-mobile-card';
import { createStandardActions } from '@/components/patterns/row-actions-helpers';
import { StandardToolbar } from '@/components/patterns/standard-toolbar';
import { StandardLayout } from '@/components/templates/standard-layout';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DatePicker } from '@/components/ui/date-picker';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useColumnVisibility } from '@/hooks/use-column-visibility';
import { useCrud } from '@/hooks/use-crud';
import { useFilterScheme } from '@/hooks/use-filter-scheme';
import { type FilterValue, useManualFilter } from '@/hooks/use-manual-filter';
import { useIsMobile } from '@/hooks/use-mobile';
import { deriveColumnsFromSchema } from '@/lib/columns-from-schema';
import { formatDateToLocalDateString, parseLocalDateString } from '@/lib/date-utils';
import { useAuthStore } from '@/stores/auth';

import {
  type PayrollFormData,
  payrollFormSchema,
  type PayrollProfile,
  toPayrollFormData,
  toPayrollPayload,
  toPayrollProfile,
} from '../types';

const PAYROLL_COLUMN_CONFIG = [
  { key: 'periodKey', label: '期间', visible: true, canHide: false },
  { key: 'employeeNameSnapshot', label: '员工', visible: true },
  { key: 'departmentNameSnapshot', label: '部门', visible: true },
  { key: 'positionSnapshot', label: '职位', visible: true },
  { key: 'actualAttendanceDays', label: '出勤天数', visible: true },
  { key: 'grossTotal', label: '应发合计', visible: true },
  { key: 'deductionTotal', label: '扣款合计', visible: true },
  { key: 'netSalary', label: '实发工资', visible: true },
  { key: 'totalLaborCost', label: '人工成本', visible: true },
  { key: 'bankNameSnapshot', label: '银行', visible: true },
  { key: 'bankCardNoSnapshot', label: '银行卡号', visible: true },
  { key: 'remarkSnapshot', label: '备注', visible: false },
  { key: 'updatedAt', label: '最近修改', visible: false },
];

const PAYROLL_PAGE_KEY = 'finance.payroll';
const PERIOD_KEY_FILTER = 'filters[periodKey]';

function readSchemeValue(
  filters: Record<string, FilterValue>,
  fieldKey: string
): FilterValue | undefined {
  return filters[`filters[${fieldKey}]`] ?? filters[`filters[${fieldKey}][]`];
}

function toPayrollQueryParams(
  filters: Record<string, FilterValue>
): Record<string, FilterValue | undefined> {
  return {
    keyword: filters.keyword || undefined,
    periodKey: readSchemeValue(filters, 'periodKey'),
    employeeId: readSchemeValue(filters, 'employeeId'),
    departmentId: readSchemeValue(filters, 'departmentId'),
    position: readSchemeValue(filters, 'position'),
    hasRemark: readSchemeValue(filters, 'hasRemark'),
  };
}

function formatAmount(value?: number | null) {
  if (value === null || value === undefined) return '-';
  return Number(value).toFixed(2);
}

function calculateTotalLaborCost(grossTotal?: number | null, companyBurdenTotal?: number | null) {
  return Number(((grossTotal ?? 0) + (companyBurdenTotal ?? 0)).toFixed(2));
}

export function RecordListView() {
  const isMobile = useIsMobile();
  const { hasMenuPermission } = useAuthStore();
  const canCreate = hasMenuPermission('finance', 'payroll', 'create');
  const canEdit = hasMenuPermission('finance', 'payroll', 'edit');
  const canDelete = hasMenuPermission('finance', 'payroll', 'delete');

  const scheme = useFilterScheme(PAYROLL_PAGE_KEY);
  const filterFields = useMemo(
    () =>
      scheme.fields.map((field) =>
        field.kind === 'text' && field.key === PERIOD_KEY_FILTER
          ? { ...field, inputType: 'month' as const }
          : field
      ),
    [scheme.fields]
  );
  const filter = useManualFilter(scheme.initialFilters, toPayrollQueryParams, scheme.version);

  const crud = useCrud<PayrollProfile, PayrollFormData, IPayrollResponse>({
    endpoint: '/payroll',
    schema: payrollFormSchema,
    validateMode: 'onSubmit',
    initialFormData: {
      periodKey: '',
      employeeId: null,
      departmentId: null,
      employeeNameSnapshot: '',
      departmentNameSnapshot: null,
      positionSnapshot: null,
      entryDateSnapshot: null,
      bankNameSnapshot: null,
      bankCardNoSnapshot: null,
      remarkSnapshot: null,
      actualAttendanceDays: null,
      absenceDays: null,
      grossBaseSalary: null,
      grossPerformance: null,
      grossCommission: null,
      grossOther: null,
      grossBonusYearEnd: null,
      grossTotal: null,
      absenceDeductionAmount: null,
      lateDeductionAmount: null,
      adminDeductionAmount: null,
      socialSecurityPersonalAmount: null,
      housingFundPersonalAmount: null,
      deductionOtherTotal: null,
      deductionTotal: null,
      socialSecurityCompanyAmount: null,
      housingFundCompanyAmount: null,
      companyBurdenTotal: null,
      netSalary: null,
      totalLaborCost: null,
    },
    entityToForm: toPayrollFormData,
    formToPayload: toPayrollPayload,
    transformData: (items) => items.map(toPayrollProfile),
    getEntityName: (entity) => `${entity.periodKey} ${entity.employeeNameSnapshot}`,
    paginationOptions: {
      initialSortBy: 'updatedAt',
      initialSortOrder: 'desc',
      extraParams: filter.apiParams,
    },
  });

  const computedTotalLaborCost = calculateTotalLaborCost(
    crud.formData.grossTotal,
    crud.formData.companyBurdenTotal
  );

  const columnVisibility = useColumnVisibility(PAYROLL_COLUMN_CONFIG, {
    onServerSortingApplied: crud.sorting.applyServerSorting,
  });

  // 表格列：从 `payrollResponseSchema` 派生。大多数金额列用内置 `decimal` 渲染；
  // periodKey（font-medium）、netSalary（font-medium）、actualAttendanceDays（特殊空值处理）
  // 保留页面 overrides。
  const columns = useMemo(
    () =>
      deriveColumnsFromSchema<PayrollProfile>(payrollResponseSchema, {
        overrides: [
          {
            key: 'periodKey',
            render: (item) => <span className="font-medium">{item.periodKey}</span>,
          },
          {
            key: 'actualAttendanceDays',
            render: (item) => (item.actualAttendanceDays ?? '-') as React.ReactNode,
          },
          {
            key: 'netSalary',
            render: (item) => (
              <span className="font-mono font-medium">{formatAmount(item.netSalary)}</span>
            ),
          },
          {
            key: 'remarkSnapshot',
            render: (item) => (
              <span className="whitespace-pre-wrap break-words">{item.remarkSnapshot || '-'}</span>
            ),
          },
        ],
      }),
    []
  );

  const rowActions = useMemo(
    () =>
      createStandardActions<PayrollProfile>({
        onView: crud.openViewDialog,
        onEdit: crud.openEditDialog,
        onDelete: crud.openDeleteDialog,
        hideEdit: !canEdit,
        hideDelete: !canDelete,
      }),
    [crud.openViewDialog, crud.openEditDialog, crud.openDeleteDialog, canEdit, canDelete]
  );

  const renderMobileCard = (item: PayrollProfile) => (
    <GenericMobileCard
      title={`${item.periodKey} · ${item.employeeNameSnapshot}`}
      status={<Badge variant="outline">{item.departmentNameSnapshot || '未匹配部门'}</Badge>}
      fields={[
        { label: '职位', value: item.positionSnapshot || '-' },
        { label: '实发工资', value: formatAmount(item.netSalary) },
        { label: '人工成本', value: formatAmount(item.totalLaborCost) },
        { label: '银行卡号', value: item.bankCardNoSnapshot || '-' },
      ]}
      onClick={() => crud.openViewDialog(item)}
      testId={`payroll-${item.id}`}
    />
  );

  return (
    <MobileBottomBarSpacer hasBottomBar={isMobile}>
      <StandardLayout
        toolbar={
          <StandardToolbar
            onCreate={canCreate ? crud.openCreateDialog : undefined}
            createLabel="新建薪资"
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
                <FilterBarSkeleton count={6} />
              ) : (
                <CrudFilterBar
                  fields={filterFields}
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
            title: '暂无薪资数据',
            description: '可以先切换到"薪资导入"Tab 导入历史工资簿，或手工新建记录',
          }}
        />

        <FormDialog
          {...crud.formDialogProps}
          variant="drawer"
          title={crud.isEditing ? '薪资详情' : '新建薪资'}
          onSubmit={crud.handleSubmit}
        >
          <div className="col-span-1 grid gap-4 md:col-span-2 md:grid-cols-2">
            {/* -- 基本信息 -- */}
            <FormField
              name="periodKey"
              label="期间"
              required
              error={crud.getFieldError('periodKey')}
              viewContent={crud.formData.periodKey}
            >
              <Input
                value={crud.formData.periodKey}
                onChange={(e) => crud.updateFormField('periodKey', e.target.value)}
                placeholder="YYYY-MM"
              />
            </FormField>
            <FormField
              name="employeeNameSnapshot"
              label="员工姓名"
              required
              error={crud.getFieldError('employeeNameSnapshot')}
              viewContent={crud.formData.employeeNameSnapshot}
            >
              <Input
                value={crud.formData.employeeNameSnapshot}
                onChange={(e) => crud.updateFormField('employeeNameSnapshot', e.target.value)}
                placeholder="请输入员工姓名"
              />
            </FormField>
            <FormField
              name="employeeId"
              label="关联员工"
              viewContent={crud.editingEntity?.employee?.name}
            >
              <EmployeeSelect
                value={crud.formData.employeeId ?? ''}
                onChange={(v) => crud.updateFormField('employeeId', v || null)}
                placeholder="可选"
              />
            </FormField>
            <FormField
              name="departmentId"
              label="关联部门"
              viewContent={
                crud.editingEntity?.department?.name || crud.formData.departmentNameSnapshot
              }
            >
              <DepartmentSelect
                value={crud.formData.departmentId ?? ''}
                onChange={(value) =>
                  crud.updateFormField('departmentId', String(value || '') || null)
                }
                placeholder="可选"
              />
            </FormField>
            <FormField
              name="departmentNameSnapshot"
              label="部门快照"
              viewContent={crud.formData.departmentNameSnapshot}
            >
              <Input
                value={crud.formData.departmentNameSnapshot || ''}
                onChange={(e) =>
                  crud.updateFormField('departmentNameSnapshot', e.target.value || null)
                }
              />
            </FormField>
            <FormField
              name="positionSnapshot"
              label="职位"
              viewContent={crud.formData.positionSnapshot}
            >
              <Input
                value={crud.formData.positionSnapshot || ''}
                onChange={(e) => crud.updateFormField('positionSnapshot', e.target.value || null)}
              />
            </FormField>
            <FormField
              name="entryDateSnapshot"
              label="入职日期"
              viewContent={crud.formData.entryDateSnapshot}
            >
              <DatePicker
                date={parseLocalDateString(crud.formData.entryDateSnapshot)}
                onDateChange={(d) =>
                  crud.updateFormField(
                    'entryDateSnapshot',
                    d ? formatDateToLocalDateString(d) : null
                  )
                }
                className="w-full"
              />
            </FormField>
            <FormField
              name="bankNameSnapshot"
              label="银行"
              viewContent={crud.formData.bankNameSnapshot}
            >
              <Input
                value={crud.formData.bankNameSnapshot || ''}
                onChange={(e) => crud.updateFormField('bankNameSnapshot', e.target.value || null)}
              />
            </FormField>
            <FormField
              name="bankCardNoSnapshot"
              label="银行卡号"
              viewContent={crud.formData.bankCardNoSnapshot}
            >
              <Input
                value={crud.formData.bankCardNoSnapshot || ''}
                onChange={(e) => crud.updateFormField('bankCardNoSnapshot', e.target.value || null)}
              />
            </FormField>
            <FormField
              name="remarkSnapshot"
              label="备注"
              fullRow
              viewContent={crud.formData.remarkSnapshot}
            >
              <Textarea
                className="min-h-24 resize-y"
                value={crud.formData.remarkSnapshot || ''}
                onChange={(e) => crud.updateFormField('remarkSnapshot', e.target.value || null)}
              />
            </FormField>

            {/* -- 考勤 -- */}
            <FormField
              name="actualAttendanceDays"
              label="实际出勤天数"
              viewContent={crud.formData.actualAttendanceDays?.toString()}
            >
              <Input
                type="number"
                step="0.001"
                value={crud.formData.actualAttendanceDays ?? ''}
                onChange={(e) =>
                  crud.updateFormField(
                    'actualAttendanceDays',
                    e.target.value === '' ? null : Number(e.target.value)
                  )
                }
              />
            </FormField>
            <FormField
              name="absenceDays"
              label="缺勤天数"
              viewContent={crud.formData.absenceDays?.toString()}
            >
              <Input
                type="number"
                step="0.001"
                value={crud.formData.absenceDays ?? ''}
                onChange={(e) =>
                  crud.updateFormField(
                    'absenceDays',
                    e.target.value === '' ? null : Number(e.target.value)
                  )
                }
              />
            </FormField>

            {/* -- 应发明细 -- */}
            <FormField
              name="grossBaseSalary"
              label="基本工资"
              viewContent={formatAmount(crud.formData.grossBaseSalary)}
            >
              <Input
                type="number"
                step="0.01"
                value={crud.formData.grossBaseSalary ?? ''}
                onChange={(e) =>
                  crud.updateFormField(
                    'grossBaseSalary',
                    e.target.value === '' ? null : Number(e.target.value)
                  )
                }
              />
            </FormField>
            <FormField
              name="grossPerformance"
              label="绩效工资"
              viewContent={formatAmount(crud.formData.grossPerformance)}
            >
              <Input
                type="number"
                step="0.01"
                value={crud.formData.grossPerformance ?? ''}
                onChange={(e) =>
                  crud.updateFormField(
                    'grossPerformance',
                    e.target.value === '' ? null : Number(e.target.value)
                  )
                }
              />
            </FormField>
            <FormField
              name="grossCommission"
              label="提成"
              viewContent={formatAmount(crud.formData.grossCommission)}
            >
              <Input
                type="number"
                step="0.01"
                value={crud.formData.grossCommission ?? ''}
                onChange={(e) =>
                  crud.updateFormField(
                    'grossCommission',
                    e.target.value === '' ? null : Number(e.target.value)
                  )
                }
              />
            </FormField>
            <FormField
              name="grossOther"
              label="其他应发"
              viewContent={formatAmount(crud.formData.grossOther)}
            >
              <Input
                type="number"
                step="0.01"
                value={crud.formData.grossOther ?? ''}
                onChange={(e) =>
                  crud.updateFormField(
                    'grossOther',
                    e.target.value === '' ? null : Number(e.target.value)
                  )
                }
              />
            </FormField>
            <FormField
              name="grossBonusYearEnd"
              label="年终奖"
              viewContent={formatAmount(crud.formData.grossBonusYearEnd)}
            >
              <Input
                type="number"
                step="0.01"
                value={crud.formData.grossBonusYearEnd ?? ''}
                onChange={(e) =>
                  crud.updateFormField(
                    'grossBonusYearEnd',
                    e.target.value === '' ? null : Number(e.target.value)
                  )
                }
              />
            </FormField>

            {/* -- 应发合计 -- */}
            <FormField
              name="grossTotal"
              label="应发合计"
              viewContent={formatAmount(crud.formData.grossTotal)}
            >
              <Input
                type="number"
                step="0.01"
                value={crud.formData.grossTotal ?? ''}
                onChange={(e) =>
                  crud.updateFormField(
                    'grossTotal',
                    e.target.value === '' ? null : Number(e.target.value)
                  )
                }
                readOnly
                className="bg-muted"
              />
            </FormField>

            {/* -- 扣款明细 -- */}
            <FormField
              name="absenceDeductionAmount"
              label="缺勤扣款"
              viewContent={formatAmount(crud.formData.absenceDeductionAmount)}
            >
              <Input
                type="number"
                step="0.01"
                value={crud.formData.absenceDeductionAmount ?? ''}
                onChange={(e) =>
                  crud.updateFormField(
                    'absenceDeductionAmount',
                    e.target.value === '' ? null : Number(e.target.value)
                  )
                }
              />
            </FormField>
            <FormField
              name="lateDeductionAmount"
              label="迟到扣款"
              viewContent={formatAmount(crud.formData.lateDeductionAmount)}
            >
              <Input
                type="number"
                step="0.01"
                value={crud.formData.lateDeductionAmount ?? ''}
                onChange={(e) =>
                  crud.updateFormField(
                    'lateDeductionAmount',
                    e.target.value === '' ? null : Number(e.target.value)
                  )
                }
              />
            </FormField>
            <FormField
              name="adminDeductionAmount"
              label="行政扣款"
              viewContent={formatAmount(crud.formData.adminDeductionAmount)}
            >
              <Input
                type="number"
                step="0.01"
                value={crud.formData.adminDeductionAmount ?? ''}
                onChange={(e) =>
                  crud.updateFormField(
                    'adminDeductionAmount',
                    e.target.value === '' ? null : Number(e.target.value)
                  )
                }
              />
            </FormField>
            <FormField
              name="socialSecurityPersonalAmount"
              label="社保个人"
              viewContent={formatAmount(crud.formData.socialSecurityPersonalAmount)}
            >
              <Input
                type="number"
                step="0.01"
                value={crud.formData.socialSecurityPersonalAmount ?? ''}
                onChange={(e) =>
                  crud.updateFormField(
                    'socialSecurityPersonalAmount',
                    e.target.value === '' ? null : Number(e.target.value)
                  )
                }
              />
            </FormField>
            <FormField
              name="housingFundPersonalAmount"
              label="公积金个人"
              viewContent={formatAmount(crud.formData.housingFundPersonalAmount)}
            >
              <Input
                type="number"
                step="0.01"
                value={crud.formData.housingFundPersonalAmount ?? ''}
                onChange={(e) =>
                  crud.updateFormField(
                    'housingFundPersonalAmount',
                    e.target.value === '' ? null : Number(e.target.value)
                  )
                }
              />
            </FormField>

            {/* -- 扣款合计 -- */}
            <FormField
              name="deductionOtherTotal"
              label="其他扣款合计"
              viewContent={formatAmount(crud.formData.deductionOtherTotal)}
            >
              <Input
                type="number"
                step="0.01"
                value={crud.formData.deductionOtherTotal ?? ''}
                onChange={(e) =>
                  crud.updateFormField(
                    'deductionOtherTotal',
                    e.target.value === '' ? null : Number(e.target.value)
                  )
                }
              />
            </FormField>
            <FormField
              name="deductionTotal"
              label="扣款合计"
              viewContent={formatAmount(crud.formData.deductionTotal)}
            >
              <Input
                type="number"
                step="0.01"
                value={crud.formData.deductionTotal ?? ''}
                onChange={(e) =>
                  crud.updateFormField(
                    'deductionTotal',
                    e.target.value === '' ? null : Number(e.target.value)
                  )
                }
                readOnly
                className="bg-muted"
              />
            </FormField>

            {/* -- 公司负担 -- */}
            <FormField
              name="socialSecurityCompanyAmount"
              label="社保公司"
              viewContent={formatAmount(crud.formData.socialSecurityCompanyAmount)}
            >
              <Input
                type="number"
                step="0.01"
                value={crud.formData.socialSecurityCompanyAmount ?? ''}
                onChange={(e) =>
                  crud.updateFormField(
                    'socialSecurityCompanyAmount',
                    e.target.value === '' ? null : Number(e.target.value)
                  )
                }
              />
            </FormField>
            <FormField
              name="housingFundCompanyAmount"
              label="公积金公司"
              viewContent={formatAmount(crud.formData.housingFundCompanyAmount)}
            >
              <Input
                type="number"
                step="0.01"
                value={crud.formData.housingFundCompanyAmount ?? ''}
                onChange={(e) =>
                  crud.updateFormField(
                    'housingFundCompanyAmount',
                    e.target.value === '' ? null : Number(e.target.value)
                  )
                }
              />
            </FormField>
            <FormField
              name="companyBurdenTotal"
              label="公司负担合计"
              viewContent={formatAmount(crud.formData.companyBurdenTotal)}
            >
              <Input
                type="number"
                step="0.01"
                value={crud.formData.companyBurdenTotal ?? ''}
                onChange={(e) =>
                  crud.updateFormField(
                    'companyBurdenTotal',
                    e.target.value === '' ? null : Number(e.target.value)
                  )
                }
                readOnly
                className="bg-muted"
              />
            </FormField>

            {/* -- 结果 -- */}
            <FormField
              name="netSalary"
              label="实发工资"
              viewContent={formatAmount(crud.formData.netSalary)}
            >
              <Input
                type="number"
                step="0.01"
                value={crud.formData.netSalary ?? ''}
                onChange={(e) =>
                  crud.updateFormField(
                    'netSalary',
                    e.target.value === '' ? null : Number(e.target.value)
                  )
                }
              />
            </FormField>
            <FormField
              name="totalLaborCost"
              label="人工成本"
              viewContent={formatAmount(crud.formData.totalLaborCost)}
            >
              <Input
                type="number"
                step="0.01"
                value={computedTotalLaborCost}
                readOnly
                className="bg-muted"
              />
            </FormField>
          </div>
        </FormDialog>

        <DeleteConfirm {...crud.deleteConfirmProps} />
        <BulkDeleteConfirm {...crud.bulkDeleteConfirmProps} />
      </StandardLayout>
      {isMobile && canCreate && (
        <MobileBottomBar>
          <Button className="flex-1" onClick={crud.openCreateDialog}>
            <Plus className="mr-2 h-4 w-4" />
            新建薪资
          </Button>
        </MobileBottomBar>
      )}
    </MobileBottomBarSpacer>
  );
}
