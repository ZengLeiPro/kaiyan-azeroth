// 触发内置渲染器注册（副作用 import）
import '@/lib/column-renderers';

import { dingtalkLogResponseSchema } from '@ky-azeroth/shared/schemas/dingtalk-log';
import type { DepartmentForSelection } from '@ky-azeroth/shared/types';
import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { FileText } from 'lucide-react';
import { useEffect, useMemo } from 'react';

import { MobileBottomBarSpacer } from '@/components/mobile';
import { BulkDeleteConfirm } from '@/components/patterns/bulk-delete-confirm';
import { CrudFilterBar } from '@/components/patterns/crud-filter-bar';
import { CrudTable } from '@/components/patterns/crud-table';
import { DeleteConfirm } from '@/components/patterns/delete-confirm';
import { DepartmentSelect } from '@/components/patterns/department-select';
import { EmployeeSelect } from '@/components/patterns/employee-select';
import { FilterBarSkeleton } from '@/components/patterns/filter-bar-skeleton';
import { FormDialog } from '@/components/patterns/form-dialog';
import { FormField } from '@/components/patterns/form-field';
import { GenericMobileCard } from '@/components/patterns/generic-mobile-card';
import { ManualSyncButton } from '@/components/patterns/manual-sync-button';
import { createStandardActions } from '@/components/patterns/row-actions-helpers';
import { StandardToolbar } from '@/components/patterns/standard-toolbar';
import { StandardLayout } from '@/components/templates/standard-layout';
import { Badge } from '@/components/ui/badge';
import { DatePicker } from '@/components/ui/date-picker';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useCrud } from '@/hooks/use-crud';
import { useFilterScheme } from '@/hooks/use-filter-scheme';
import { useManualFilter } from '@/hooks/use-manual-filter';
import { useIsMobile } from '@/hooks/use-mobile';
import { api } from '@/lib/api';
import { deriveColumnsFromSchema } from '@/lib/columns-from-schema';
import { useAuthStore } from '@/stores/auth';

import {
  type DingtalkLogFormData,
  dingtalkLogFormSchema,
  type DingtalkLogProfile,
  SECTION_KEYS,
  todayYmd,
  toDingtalkLogFormData,
  toDingtalkLogPayload,
  toDingtalkLogProfile,
  ymdToDate,
} from './types';

function formatCreateTime(value: string | null | undefined): string {
  if (!value) return '-';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '-' : format(date, 'yyyy-MM-dd HH:mm:ss');
}

const SOURCE_LABELS: Record<string, { label: string; variant: 'default' | 'secondary' }> = {
  dingtalk: { label: '钉钉同步', variant: 'secondary' },
  local: { label: '本地', variant: 'default' },
};

const TEMPLATE_OPTIONS = [
  { value: '日报', label: '日报' },
  { value: '周报', label: '周报' },
  { value: '月报', label: '月报' },
];

export function DingtalkLogsPage() {
  useIsMobile();

  // 筛选字段 + 初始 state 全由服务端的 filter-scheme registry/config 驱动。
  const scheme = useFilterScheme('reports.dingtalk_logs');
  const filter = useManualFilter(scheme.initialFilters, undefined, scheme.version);

  // 当前登录用户信息（用于"提交人"默认值）
  const currentUser = useAuthStore((state) => state.user);
  const currentEmployeeId = currentUser?.employee?.id ?? '';
  const currentEmployeeName = currentUser?.employee?.name ?? '';

  // 全量部门列表：用于 deptId ↔ deptName 双向映射（编辑场景预填、提交人联动）
  const { data: departments = [] } = useQuery({
    queryKey: ['departments', 'all'],
    queryFn: async () => {
      const res = await api.get<DepartmentForSelection[]>('/departments/all');
      return res.data;
    },
    staleTime: 5 * 60 * 1000,
  });

  /**
   * 新增表单默认值：提交人 = 当前登录员工，报告日期 = 今天，
   * 日志模板默认日报，两段内容空白等填写。
   */
  const initialFormData = useMemo<DingtalkLogFormData>(
    () => ({
      templateName: '日报',
      creatorId: currentEmployeeId,
      creatorName: currentEmployeeName,
      deptId: '',
      deptName: '',
      reportDate: todayYmd(),
      sections: SECTION_KEYS.map((key) => ({ key, value: '' })),
    }),
    [currentEmployeeId, currentEmployeeName]
  );

  const crud = useCrud<DingtalkLogProfile, DingtalkLogFormData>({
    endpoint: '/dingtalk-logs',
    schema: dingtalkLogFormSchema,
    validateMode: 'onSubmit',
    initialFormData,
    entityToForm: toDingtalkLogFormData,
    formToPayload: toDingtalkLogPayload,
    getEntityName: (entity) => entity.templateName || entity.reportId,
    transformData: (data) => data.map(toDingtalkLogProfile),
    paginationOptions: {
      extraParams: filter.apiParams,
    },
  });

  /**
   * 编辑场景下，实体只存了 deptName 不存 deptId。departments 加载后按名字精确反查
   * 把 deptId 补上，让 DepartmentSelect 能正确显示当前部门。
   * 钉钉同步过来的部门名可能与系统部门对不上，反查失败时 deptId 保持为空，
   * 提交时必填校验会提示用户重新选。
   *
   * 解构出基础类型/函数引用单独依赖，避免 useEffect 整体依赖 crud 对象引起的
   * `react-hooks/exhaustive-deps` 警告。
   */
  const formMode = crud.formDialogProps.mode;
  const { deptId: formDeptId, deptName: formDeptName } = crud.formData;
  const updateFormField = crud.updateFormField;
  useEffect(() => {
    if (formMode === 'view') return;
    if (formDeptId) return;
    if (!formDeptName) return;
    if (departments.length === 0) return;
    const matched = departments.find((d) => d.name === formDeptName);
    if (matched) {
      updateFormField('deptId', matched.id);
    }
  }, [formMode, formDeptId, formDeptName, departments, updateFormField]);

  /**
   * 列定义：从 `dingtalkLogResponseSchema` 派生列头/宽度/datetime 渲染；
   * 复杂 render（加粗标题、muted 文字、来源徽章）在 overrides 里保留。
   */
  const columns = useMemo(
    () =>
      deriveColumnsFromSchema<DingtalkLogProfile>(dingtalkLogResponseSchema, {
        overrides: [
          {
            key: 'templateName',
            render: (log) => <span className="font-medium">{log.templateName || '-'}</span>,
          },
          {
            key: 'creatorName',
            render: (log) => (
              <span className="text-muted-foreground">{log.creatorName || '-'}</span>
            ),
          },
          {
            key: 'deptName',
            render: (log) => <span className="text-muted-foreground">{log.deptName || '-'}</span>,
          },
          {
            key: 'createTime',
            width: 180,
            render: (log) => (
              <span className="text-muted-foreground">{formatCreateTime(log.createTime)}</span>
            ),
          },
          {
            key: 'contents',
            render: (log) => {
              if (!log.contents) return '-';
              const text = log.contents.replace(/\r\n|\r|\n/g, ' ').trim();
              if (!text) return '-';
              return (
                <span className="line-clamp-1 text-muted-foreground" title={log.contents}>
                  {text.length > 40 ? `${text.slice(0, 40)}...` : text}
                </span>
              );
            },
          },
          {
            key: 'source',
            render: (log) => {
              const cfg = SOURCE_LABELS[log.source ?? 'dingtalk'];
              if (!cfg) return '-';
              return (
                <div className="flex items-center gap-1">
                  <Badge variant={cfg.variant}>{cfg.label}</Badge>
                  {log.isLocallyEdited && log.source === 'dingtalk' && (
                    <Badge variant="outline" className="text-[10px]">
                      已编辑
                    </Badge>
                  )}
                </div>
              );
            },
          },
        ],
      }),
    []
  );

  const rowActions = useMemo(
    () =>
      createStandardActions<DingtalkLogProfile>({
        onView: crud.openViewDialog,
        onEdit: crud.openEditDialog,
        onDelete: crud.openDeleteDialog,
      }),
    [crud.openViewDialog, crud.openEditDialog, crud.openDeleteDialog]
  );

  const renderMobileCard = (log: DingtalkLogProfile) => (
    <GenericMobileCard
      title={log.templateName || '未命名日志'}
      icon={<FileText className="h-4 w-4" />}
      status={
        <Badge variant={SOURCE_LABELS[log.source ?? 'dingtalk']?.variant ?? 'secondary'}>
          {SOURCE_LABELS[log.source ?? 'dingtalk']?.label ?? '钉钉'}
        </Badge>
      }
      fields={[
        { label: '提交人', value: log.creatorName || '-' },
        { label: '部门', value: log.deptName || '-' },
        {
          label: '创建时间',
          value: formatCreateTime(log.createTime),
        },
      ]}
      onClick={() => crud.openViewDialog(log)}
      testId={`dingtalk-log-${log.id}`}
    />
  );

  /**
   * 钉钉日志正文是带 \r\n 换行的纯文本，保留换行展示即可（查看态）
   */
  const formatContents = (contents: string | null | undefined) => {
    if (!contents) return '-';
    const text = contents.replace(/\r\n?/g, '\n').trim();
    if (!text) return '-';
    return (
      <pre className="whitespace-pre-wrap break-words font-sans text-sm text-muted-foreground">
        {text}
      </pre>
    );
  };

  // sections 固定两段，只编辑 value（内容），key 始终为「今日工作」/「明日计划」
  const handleSectionValueChange = (index: number, value: string) => {
    const next = [...crud.formData.sections];
    if (next[index]) {
      next[index] = { ...next[index], value };
      crud.updateFormField('sections', next);
    }
  };

  return (
    <MobileBottomBarSpacer>
      <StandardLayout
        toolbar={
          <StandardToolbar
            onSearch={filter.search}
            onReset={filter.reset}
            onCreate={crud.openCreateDialog}
            createLabel="新增日志"
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
            actions={
              <ManualSyncButton
                endpoint="/dingtalk-sync/logs"
                label="同步日志"
                onSuccess={crud.refresh}
                successMessage={(d) => `已同步 ${d.count} 条日志`}
                errorFallback="同步日志失败"
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
          actions={rowActions}
          loading={crud.loading}
          onRowClick={crud.openViewDialog}
          renderMobileCard={renderMobileCard}
          rowSelection={crud.rowSelectionProps}
          hidePagination
          emptyState={{
            title: '暂无钉钉日志',
            description: '可点击"同步日志"从钉钉拉取，或"新增日志"手工录入',
            icon: <FileText className="h-12 w-12 text-muted-foreground/50" />,
          }}
        />

        <FormDialog
          {...crud.formDialogProps}
          variant="drawer"
          title={crud.isEditing ? '钉钉日志' : '新增钉钉日志'}
          onSubmit={crud.handleSubmit}
        >
          {/* 第 1 行：日志模板 + 报告日期 */}
          <FormField
            name="templateName"
            label="日志模板"
            required
            error={crud.getFieldError('templateName')}
            viewContent={crud.formData.templateName || '-'}
          >
            <Select
              options={TEMPLATE_OPTIONS}
              value={crud.formData.templateName}
              onChange={(value) => crud.updateFormField('templateName', value ?? '日报')}
              placeholder="选择日志模板"
            />
          </FormField>

          <FormField
            name="reportDate"
            label="报告日期"
            required
            error={crud.getFieldError('reportDate')}
            viewContent={
              crud.formData.reportDate
                ? new Date(crud.formData.reportDate).toLocaleDateString('zh-CN')
                : '-'
            }
          >
            <DatePicker
              date={ymdToDate(crud.formData.reportDate)}
              onDateChange={(d) => {
                if (!d) {
                  crud.updateFormField('reportDate', '');
                  return;
                }
                const pad = (n: number) => String(n).padStart(2, '0');
                const ymd = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
                crud.updateFormField('reportDate', ymd);
              }}
              className="w-full"
              placeholder="选择报告日期"
            />
          </FormField>

          {/* 第 2 行：提交人 + 部门 */}
          <FormField
            name="creatorId"
            label="提交人"
            required
            error={crud.getFieldError('creatorId')}
            viewContent={crud.formData.creatorName || '-'}
          >
            <EmployeeSelect
              value={crud.formData.creatorId}
              onChange={(value) => crud.updateFormField('creatorId', value)}
              onSelect={(employee) => {
                crud.updateFormField('creatorName', employee?.name ?? '');
              }}
              placeholder="选择提交人"
            />
          </FormField>

          <FormField
            name="deptId"
            label="部门"
            required
            error={crud.getFieldError('deptId')}
            viewContent={crud.formData.deptName || '-'}
          >
            <DepartmentSelect
              value={crud.formData.deptId}
              onChange={(value) => {
                const id = Array.isArray(value) ? (value[0] ?? '') : value;
                crud.updateFormField('deptId', id);
                const matched = departments.find((d) => d.id === id);
                crud.updateFormField('deptName', matched?.name ?? '');
              }}
              placeholder="选择部门"
            />
          </FormField>

          {/* 第 3 行：日志内容（占满整行） */}
          <FormField
            name="sections"
            label="日志内容"
            required
            error={crud.getFieldError('sections')}
            viewContent={formatContents(
              crud.formData.sections.map((s) => `${s.key}: ${s.value}`).join('\n')
            )}
            fullRow
          >
            <div className="space-y-3">
              {crud.formData.sections.map((section, index) => (
                <div
                  key={section.key}
                  className="space-y-2 rounded-md border border-border bg-muted/30 p-3"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">
                      {section.key}
                      <span className="ml-1 text-destructive">*</span>
                    </span>
                  </div>
                  <Textarea
                    placeholder={`请输入${section.key}内容`}
                    rows={4}
                    value={section.value}
                    onChange={(e) => handleSectionValueChange(index, e.target.value)}
                  />
                </div>
              ))}
            </div>
          </FormField>
        </FormDialog>

        <DeleteConfirm {...crud.deleteConfirmProps} />
        <BulkDeleteConfirm {...crud.bulkDeleteConfirmProps} />
      </StandardLayout>
    </MobileBottomBarSpacer>
  );
}
