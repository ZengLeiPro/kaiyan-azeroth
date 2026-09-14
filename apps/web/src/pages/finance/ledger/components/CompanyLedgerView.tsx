import {
  type CreateFinanceLedgerInput,
  createFinanceLedgerSchema,
  type FinanceLedgerResponseOutput,
} from '@ky-azeroth/shared/schemas';
import { Plus } from 'lucide-react';
import { useEffect, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import type { z } from 'zod';

import { MobileBottomBar, MobileBottomBarSpacer } from '@/components/mobile';
import { ColumnVisibilityDropdown } from '@/components/patterns/column-visibility';
import { CrudFilterBar, type FilterOption } from '@/components/patterns/crud-filter-bar';
import { CrudTable } from '@/components/patterns/crud-table';
import { DeleteConfirm } from '@/components/patterns/delete-confirm';
import { FilterBarSkeleton } from '@/components/patterns/filter-bar-skeleton';
import { FormDialog } from '@/components/patterns/form-dialog';
import { FormField } from '@/components/patterns/form-field';
import { GenericMobileCard } from '@/components/patterns/generic-mobile-card';
import { createStandardActions } from '@/components/patterns/row-actions-helpers';
import { StandardToolbar } from '@/components/patterns/standard-toolbar';
import { StandardLayout } from '@/components/templates/standard-layout';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { DataTableColumn } from '@/components/ui/data-table';
import { DatePicker } from '@/components/ui/date-picker';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useColumnVisibility } from '@/hooks/use-column-visibility';
import { useCrud } from '@/hooks/use-crud';
import { useFilterScheme } from '@/hooks/use-filter-scheme';
import { type FilterValue, useManualFilter } from '@/hooks/use-manual-filter';
import { useIsMobile } from '@/hooks/use-mobile';
import { getErrorMessage } from '@/lib/api';
import {
  formatDateToLocalDateString,
  getTodayDateString,
  parseLocalDateString,
} from '@/lib/date-utils';

import {
  DRILLDOWN_PARAM_KEYS,
  FINANCE_CATEGORY_LABEL,
  FINANCE_DIRECTION_FORM_OPTIONS,
  FINANCE_DIRECTION_LABEL,
  FINANCE_LEDGER_YEAR,
  FINANCE_SOURCE_LABEL,
  formatLedgerAmount,
  formatLedgerDate,
  getOptionLabel,
} from '../shared';
import { LedgerAmountCell } from './LedgerAmountCell';

const LEDGER_COLUMN_CONFIG = [
  { key: 'txDate', label: '日期', visible: true, canHide: false },
  { key: 'accountName', label: '账户', visible: true },
  { key: 'subjectName', label: '科目', visible: true },
  { key: 'subjectCategory', label: '大类', visible: false },
  { key: 'remark', label: '备注', visible: true },
  { key: 'amount', label: '金额', visible: true },
  { key: 'direction', label: '方向', visible: true },
  { key: 'runningBalance', label: '账户余额', visible: true },
  { key: 'source', label: '来源', visible: true },
  { key: 'dingtalkSheetName', label: '钉钉表', visible: false },
];

const LEDGER_PAGE_KEY = 'finance.ledger' as const;
const TX_DATE_FROM_KEY = 'filters[txDate][from]';
const TX_DATE_TO_KEY = 'filters[txDate][to]';
const ACCOUNT_ID_KEY = 'filters[accountId]';
const SUBJECT_ID_KEY = 'filters[subjectId]';

function readSchemeValue(
  filters: Record<string, FilterValue>,
  fieldKey: string
): FilterValue | undefined {
  return filters[`filters[${fieldKey}]`] ?? filters[`filters[${fieldKey}][]`];
}

function toLedgerQueryParams(
  filters: Record<string, FilterValue>
): Record<string, FilterValue | undefined> {
  return {
    keyword: filters.keyword || undefined,
    startDate: filters[TX_DATE_FROM_KEY] || undefined,
    endDate: filters[TX_DATE_TO_KEY] || undefined,
    accountId: readSchemeValue(filters, 'accountId'),
    subjectId: readSchemeValue(filters, 'subjectId'),
    category: readSchemeValue(filters, 'category'),
    direction: readSchemeValue(filters, 'direction'),
    source: readSchemeValue(filters, 'source'),
  };
}

const ledgerFormSchema = createFinanceLedgerSchema.pick({
  txDate: true,
  accountId: true,
  subjectId: true,
  amount: true,
  direction: true,
  remark: true,
}) as unknown as z.ZodType<LedgerFormData>;

type LedgerFormData = Omit<
  Pick<
    CreateFinanceLedgerInput,
    'txDate' | 'accountId' | 'subjectId' | 'amount' | 'direction' | 'remark'
  >,
  'amount'
> & {
  /** @precision Decimal */
  amount: number | null;
};

interface CompanyLedgerViewProps {
  /** 由 Hub 注入的账户下拉（含"全部账户"哨兵项） */
  accountOptions: FilterOption[];
  /** 由 Hub 注入的科目下拉（含"全部科目"哨兵项） */
  subjectOptions: FilterOption[];
}

export function CompanyLedgerView({ accountOptions, subjectOptions }: CompanyLedgerViewProps) {
  const isMobile = useIsMobile();
  const [searchParams, setSearchParams] = useSearchParams();

  const scheme = useFilterScheme(LEDGER_PAGE_KEY);
  const initialFilters = useMemo(() => {
    const next = { ...scheme.initialFilters };
    if (TX_DATE_FROM_KEY in next) next[TX_DATE_FROM_KEY] = `${FINANCE_LEDGER_YEAR}-01-01`;
    if (TX_DATE_TO_KEY in next) next[TX_DATE_TO_KEY] = `${FINANCE_LEDGER_YEAR}-12-31`;
    return next;
  }, [scheme.initialFilters]);
  const filterFields = useMemo(
    () =>
      scheme.fields.map((field) => {
        if (field.kind === 'select' && field.key === ACCOUNT_ID_KEY) {
          return { ...field, options: accountOptions };
        }
        if (field.kind === 'select' && field.key === SUBJECT_ID_KEY) {
          return { ...field, options: subjectOptions };
        }
        return field;
      }),
    [scheme.fields, accountOptions, subjectOptions]
  );
  const filter = useManualFilter(initialFilters, toLedgerQueryParams, scheme.version);
  const initialFormData = useMemo<LedgerFormData>(
    () => ({
      txDate: getTodayDateString(),
      accountId: '',
      subjectId: '',
      amount: null,
      direction: undefined,
      remark: null,
    }),
    []
  );
  const crud = useCrud<FinanceLedgerResponseOutput, LedgerFormData>({
    endpoint: '/finance-ledger',
    schema: ledgerFormSchema,
    validateMode: 'onSubmit',
    initialFormData,
    entityToForm: toLedgerFormData,
    formToPayload: toLedgerPayload,
    getEntityName: (item) =>
      `${formatLedgerDate(item.txDate)} ${item.subjectName ?? '流水'} ${formatLedgerAmount(item.amount)}`,
    paginationOptions: {
      extraParams: filter.apiParams,
      initialPageSize: 100,
    },
  });
  const columnVisibility = useColumnVisibility(LEDGER_COLUMN_CONFIG);

  const ledgerAccountOptions = useMemo(
    () => accountOptions.filter((option) => option.value),
    [accountOptions]
  );
  const ledgerSubjectOptions = useMemo(
    () => subjectOptions.filter((option) => option.value),
    [subjectOptions]
  );

  useEffect(() => {
    if (crud.error) {
      toast.error(getErrorMessage(crud.error, '加载公司流水失败'));
    }
  }, [crud.error]);

  /**
   * PnL 钻取参数应用：URL 出现 subjectId/startDate/endDate 时，桥接到方案筛选并清掉 URL。
   * 清掉是为了让用户随后手动修改筛选时，刷新或其他 URL 改动不会把钻取参数粘回来。
   */
  useEffect(() => {
    const subjectId = searchParams.get(DRILLDOWN_PARAM_KEYS.subjectId);
    const startDate = searchParams.get(DRILLDOWN_PARAM_KEYS.startDate);
    const endDate = searchParams.get(DRILLDOWN_PARAM_KEYS.endDate);
    if (!subjectId && !startDate && !endDate) return;

    filter.applyFilters({
      ...(subjectId ? { [SUBJECT_ID_KEY]: subjectId } : {}),
      ...(startDate ? { [TX_DATE_FROM_KEY]: startDate } : {}),
      ...(endDate ? { [TX_DATE_TO_KEY]: endDate } : {}),
    });

    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete(DRILLDOWN_PARAM_KEYS.subjectId);
        next.delete(DRILLDOWN_PARAM_KEYS.startDate);
        next.delete(DRILLDOWN_PARAM_KEYS.endDate);
        return next;
      },
      { replace: true }
    );
    // filter.applyFilters 与 setSearchParams 都是 useCallback 引用稳定，只依赖 searchParams 变更即可。
  }, [searchParams, filter, setSearchParams]);

  const columns = useMemo<DataTableColumn<FinanceLedgerResponseOutput>[]>(
    () => [
      {
        key: 'txDate',
        header: '日期',
        width: 120,
        render: (item) => (
          <span className="font-mono text-xs">{formatLedgerDate(item.txDate)}</span>
        ),
      },
      {
        key: 'accountName',
        header: '账户',
        width: 140,
        render: (item) => item.accountName ?? '-',
      },
      {
        key: 'subjectName',
        header: '科目',
        width: 180,
        render: (item) => <span className="font-medium">{item.subjectName ?? '-'}</span>,
      },
      {
        key: 'subjectCategory',
        header: '大类',
        width: 140,
        render: (item) => (
          <Badge variant="outline">
            {item.subjectCategory
              ? (FINANCE_CATEGORY_LABEL[item.subjectCategory] ?? item.subjectCategory)
              : '-'}
          </Badge>
        ),
      },
      {
        key: 'remark',
        header: '备注',
        width: 260,
        render: (item) => (
          <span className="whitespace-pre-wrap break-words text-xs text-muted-foreground">
            {item.remark || '-'}
          </span>
        ),
      },
      {
        key: 'amount',
        header: '金额',
        width: 140,
        align: 'right',
        render: (item) => <LedgerAmountCell value={item.amount} />,
      },
      {
        key: 'direction',
        header: '方向',
        width: 100,
        render: (item) => (
          <Badge variant={item.direction === 'in' ? 'success' : 'warning'}>
            {FINANCE_DIRECTION_LABEL[item.direction] ?? item.direction}
          </Badge>
        ),
      },
      {
        key: 'runningBalance',
        header: '账户余额',
        width: 140,
        align: 'right',
        render: (item) => <LedgerAmountCell value={item.runningBalance} muted />,
      },
      {
        key: 'source',
        header: '来源',
        width: 100,
        render: (item) => (
          <Badge variant={item.source === 'dingtalk_import' ? 'info' : 'outline'}>
            {FINANCE_SOURCE_LABEL[item.source] ?? item.source}
          </Badge>
        ),
      },
      {
        key: 'dingtalkSheetName',
        header: '钉钉表',
        width: 160,
        render: (item) => item.dingtalkSheetName ?? '-',
      },
    ],
    []
  );

  const rowActions = useMemo(
    () =>
      createStandardActions<FinanceLedgerResponseOutput>({
        onView: crud.openViewDialog,
        onEdit: crud.openEditDialog,
        onDelete: crud.openDeleteDialog,
      }),
    [crud.openViewDialog, crud.openEditDialog, crud.openDeleteDialog]
  );

  const renderMobileCard = (item: FinanceLedgerResponseOutput) => (
    <GenericMobileCard
      title={`${formatLedgerDate(item.txDate)} · ${item.subjectName ?? '-'}`}
      status={
        <Badge variant={item.direction === 'in' ? 'success' : 'warning'}>
          {FINANCE_DIRECTION_LABEL[item.direction] ?? item.direction}
        </Badge>
      }
      fields={[
        { label: '账户', value: item.accountName ?? '-' },
        { label: '金额', value: formatLedgerAmount(item.amount) },
        { label: '账户余额', value: formatLedgerAmount(item.runningBalance) },
        { label: '备注', value: item.remark || '-', fullWidth: true },
      ]}
      onClick={() => crud.openViewDialog(item)}
      testId={`finance-ledger-${item.id}`}
    />
  );

  return (
    <MobileBottomBarSpacer hasBottomBar={isMobile}>
      <StandardLayout
        toolbar={
          <StandardToolbar
            onCreate={crud.openCreateDialog}
            createLabel="新建流水"
            onSearch={filter.search}
            onReset={filter.reset}
            actions={
              <ColumnVisibilityDropdown
                columns={columnVisibility.columns}
                onToggle={columnVisibility.toggleColumn}
                onShowAll={columnVisibility.showAll}
                onResetVisibility={columnVisibility.resetToDefault}
                onReorder={columnVisibility.reorderColumns}
              />
            }
            filters={
              scheme.isLoading ? (
                <FilterBarSkeleton count={7} />
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
          onRowClick={crud.openViewDialog}
          renderMobileCard={renderMobileCard}
          columnVisibility={{
            columns: columnVisibility.columns,
            onToggle: columnVisibility.toggleColumn,
            onShowAll: columnVisibility.showAll,
          }}
          hidePagination
          emptyState={{
            title: '暂无公司流水',
            description: '点击"新建流水"添加第一条记录',
          }}
        />

        <FormDialog
          {...crud.formDialogProps}
          variant="drawer"
          title={crud.isEditing ? '流水详情' : '新建流水'}
          onSubmit={crud.handleSubmit}
        >
          <>
            <FormField
              name="txDate"
              label="日期"
              required
              error={crud.getFieldError('txDate')}
              viewContent={formatLedgerDate(crud.formData.txDate)}
            >
              <DatePicker
                date={parseLocalDateString(crud.formData.txDate)}
                onDateChange={(d) =>
                  crud.updateFormField('txDate', d ? formatDateToLocalDateString(d) : '')
                }
                className="w-full"
              />
            </FormField>

            <FormField
              name="accountId"
              label="账户"
              required
              error={crud.getFieldError('accountId')}
              viewContent={
                crud.editingEntity?.accountName ??
                getOptionLabel(accountOptions, crud.formData.accountId)
              }
            >
              <Select
                options={ledgerAccountOptions}
                value={crud.formData.accountId}
                onValueChange={(value) => crud.updateFormField('accountId', value ?? '')}
                placeholder="请选择账户"
                searchable
              />
            </FormField>

            <FormField
              name="subjectId"
              label="科目"
              required
              error={crud.getFieldError('subjectId')}
              viewContent={
                crud.editingEntity?.subjectName ??
                getOptionLabel(subjectOptions, crud.formData.subjectId)
              }
            >
              <Select
                options={ledgerSubjectOptions}
                value={crud.formData.subjectId}
                onValueChange={(value) => crud.updateFormField('subjectId', value ?? '')}
                placeholder="请选择科目"
                searchable
              />
            </FormField>

            <FormField
              name="amount"
              label="金额"
              required
              error={crud.getFieldError('amount')}
              helpText="正数为收入，负数为支出。方向留空时由金额符号自动判断。"
              viewContent={<LedgerAmountCell value={crud.formData.amount} />}
            >
              <Input
                id="amount"
                type="number"
                step="0.01"
                placeholder="请输入金额"
                value={crud.formData.amount ?? ''}
                onChange={(e) =>
                  crud.updateFormField(
                    'amount',
                    e.target.value === '' ? null : Number(e.target.value)
                  )
                }
              />
            </FormField>

            <FormField
              name="direction"
              label="方向"
              error={crud.getFieldError('direction')}
              viewContent={
                crud.formData.direction
                  ? FINANCE_DIRECTION_LABEL[crud.formData.direction]
                  : '自动判断'
              }
            >
              <Select
                options={FINANCE_DIRECTION_FORM_OPTIONS}
                value={crud.formData.direction ?? ''}
                onValueChange={(value) =>
                  crud.updateFormField(
                    'direction',
                    value ? (value as LedgerFormData['direction']) : undefined
                  )
                }
              />
            </FormField>

            <FormField
              name="remark"
              label="备注"
              fullRow
              error={crud.getFieldError('remark')}
              viewContent={crud.formData.remark}
            >
              <Textarea
                id="remark"
                placeholder="请输入备注"
                value={crud.formData.remark ?? ''}
                onChange={(e) => crud.updateFormField('remark', e.target.value || null)}
                rows={3}
              />
            </FormField>

            {crud.editingEntity && (
              <>
                <FormField
                  name="runningBalance"
                  label="账户余额"
                  forceView
                  viewContent={<LedgerAmountCell value={crud.editingEntity.runningBalance} muted />}
                />
                <FormField
                  name="source"
                  label="来源"
                  forceView
                  viewContent={
                    <Badge
                      variant={crud.editingEntity.source === 'dingtalk_import' ? 'info' : 'outline'}
                    >
                      {FINANCE_SOURCE_LABEL[crud.editingEntity.source] ?? crud.editingEntity.source}
                    </Badge>
                  }
                />
                {crud.editingEntity.dingtalkSheetName && (
                  <FormField
                    name="dingtalkSheetName"
                    label="钉钉表"
                    forceView
                    viewContent={`${crud.editingEntity.dingtalkSheetName}${
                      crud.editingEntity.dingtalkRowIndex
                        ? ` #${crud.editingEntity.dingtalkRowIndex}`
                        : ''
                    }`}
                  />
                )}
              </>
            )}
          </>
        </FormDialog>

        <DeleteConfirm {...crud.deleteConfirmProps} />
      </StandardLayout>
      {isMobile && (
        <MobileBottomBar>
          <Button className="flex-1" onClick={crud.openCreateDialog}>
            <Plus className="mr-2 h-4 w-4" />
            新建流水
          </Button>
        </MobileBottomBar>
      )}
    </MobileBottomBarSpacer>
  );
}

function toLedgerFormData(entity: FinanceLedgerResponseOutput): LedgerFormData {
  return {
    txDate: formatLedgerDate(entity.txDate),
    accountId: entity.accountId,
    subjectId: entity.subjectId,
    amount: entity.amount == null ? null : Number(entity.amount),
    direction: entity.direction as LedgerFormData['direction'],
    remark: entity.remark ?? null,
  };
}

function toLedgerPayload(form: LedgerFormData) {
  return {
    txDate: form.txDate,
    accountId: form.accountId,
    subjectId: form.subjectId,
    amount: form.amount == null ? null : String(form.amount),
    direction: form.direction,
    remark: form.remark?.trim() || null,
  };
}
