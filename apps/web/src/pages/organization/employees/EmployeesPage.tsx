// 触发内置渲染器/导出格式化器注册（副作用 import）
import '@/lib/column-renderers';
import '@/lib/column-export-formatters';

import { EMPLOYEE_STATUS_LABELS } from '@ky-azeroth/shared/constants/status-labels';
import { EMPLOYEE_STATUS } from '@ky-azeroth/shared/constants/status-values';
import { employeeResponseSchema } from '@ky-azeroth/shared/schemas/employee';
import type { IEmployeeResponse } from '@ky-azeroth/shared/types/employee';
import { Plus, Users } from 'lucide-react';
import { useEffect, useMemo } from 'react';

import { MobileBottomBar, MobileBottomBarSpacer } from '@/components/mobile';
import { BulkDeleteConfirm } from '@/components/patterns/bulk-delete-confirm';
import { CrudFilterBar } from '@/components/patterns/crud-filter-bar';
import { CrudTable } from '@/components/patterns/crud-table';
import { DeleteConfirm } from '@/components/patterns/delete-confirm';
import { DepartmentSelect } from '@/components/patterns/department-select';
import { FilterBarSkeleton } from '@/components/patterns/filter-bar-skeleton';
import { FormDialog } from '@/components/patterns/form-dialog';
import { FormField, type FormFieldProps } from '@/components/patterns/form-field';
import { GenericMobileCard } from '@/components/patterns/generic-mobile-card';
import { createStandardActions } from '@/components/patterns/row-actions-helpers';
import { StandardToolbar } from '@/components/patterns/standard-toolbar';
import { StatusBadge } from '@/components/patterns/status-badge';
import { StandardLayout } from '@/components/templates/standard-layout';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DatePicker } from '@/components/ui/date-picker';
import { Input } from '@/components/ui/input';
import {
  SelectContent,
  SelectItem,
  SelectRoot,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useCrud } from '@/hooks/use-crud';
import { useFilterScheme } from '@/hooks/use-filter-scheme';
import { useManualFilter } from '@/hooks/use-manual-filter';
import { useIsMobile } from '@/hooks/use-mobile';
import { deriveColumnsFromSchema } from '@/lib/columns-from-schema';
import {
  formatDateDisplay,
  formatDateTimeDisplay,
  formatDateToLocalDateString,
  parseLocalDateString,
} from '@/lib/date-utils';
import { employeeStatusMap, genderMap, loginStatusMap } from '@/lib/status-maps';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/stores/auth';

import {
  type EmployeeFormData,
  employeeFormSchema,
  type EmployeeProfile,
  toEmployeeFormData,
  toEmployeePayload,
  toEmployeeProfile,
} from './types';

// 职位选项
const POSITION_OPTIONS = [
  { value: '经理', label: '经理' },
  { value: '主管', label: '主管' },
  { value: '销售', label: '销售' },
  { value: '助理', label: '助理' },
  { value: '客服', label: '客服' },
] as const;

// 性别选项
const GENDER_OPTIONS = [
  { value: 'male', label: '男' },
  { value: 'female', label: '女' },
] as const;

function EmployeeAvatar({
  src,
  name,
  size = 'sm',
}: {
  src?: string | null;
  name?: string | null;
  size?: 'sm' | 'lg';
}) {
  const dimension = size === 'lg' ? 'h-16 w-16 text-xl' : 'h-8 w-8 text-xs';
  const fallback = (name?.trim()?.slice(0, 1) || '?').toUpperCase();
  if (src) {
    return (
      <img
        src={src}
        alt={name ?? ''}
        className={cn(dimension, 'rounded-full bg-muted object-cover')}
        onError={(e) => {
          (e.currentTarget as HTMLImageElement).style.display = 'none';
        }}
      />
    );
  }
  return (
    <div
      className={cn(
        dimension,
        'flex items-center justify-center rounded-full bg-muted text-muted-foreground'
      )}
    >
      {fallback}
    </div>
  );
}

/**
 * 获取员工身份标签列表
 * 将 isAdmin/isBoss/isLeader 布尔值组合为可读标签
 */
function getIdentityLabels(employee: EmployeeProfile): string[] {
  const labels: string[] = [];
  if (employee.isBoss) labels.push('老板');
  if (employee.isAdmin) labels.push('管理员');
  if (employee.isLeader) labels.push('主管');
  return labels;
}

function formatDateTime(value?: string | null): string {
  return formatDateTimeDisplay(value) || '-';
}

function formatDate(value?: string | null): string {
  return value ? new Date(value).toLocaleDateString('zh-CN') : '-';
}

function formatBoolean(value?: boolean): string {
  if (value === undefined) return '-';
  return value ? '是' : '否';
}

function formatHourlyRate(value?: number | null): string {
  return value != null ? `${value.toFixed(2)} 元/小时` : '-';
}

function formatJson(value?: Record<string, unknown> | null): string {
  return value ? JSON.stringify(value, null, 2) : '-';
}

function ReadOnlyFormField(props: FormFieldProps) {
  return <FormField {...props} forceView />;
}

export function EmployeesPage() {
  const isMobile = useIsMobile();
  const { hasMenuPermission } = useAuthStore();
  const canCreate = hasMenuPermission('organization', 'employees', 'create');
  const canEdit = hasMenuPermission('organization', 'employees', 'edit');
  const canDelete = hasMenuPermission('organization', 'employees', 'delete');

  // 筛选字段 + 初始 state 由服务端的 filter-scheme registry/config 驱动。
  // 注意：departmentId 是 employees ↔ departments 的 M2M relation，不在 registry 里；
  // 保留独立 DepartmentSelect 作为 legacy query 参数传给 service baseWhere。
  const scheme = useFilterScheme('organization.employees');
  const initialFilters = useMemo<Record<string, string | string[]>>(
    () => ({ ...scheme.initialFilters, departmentId: '' }),
    [scheme.initialFilters]
  );
  const filter = useManualFilter(initialFilters, undefined, scheme.version);

  const crud = useCrud<EmployeeProfile, EmployeeFormData, IEmployeeResponse>({
    endpoint: '/employees',
    schema: employeeFormSchema,
    validateMode: 'onChange',
    initialFormData: {
      name: '',
      phone: null,
      email: null,
      gender: null,
      entryDate: null,
      position: null,
      hourlyRate: null,
      status: EMPLOYEE_STATUS.ACTIVE,
      avatar: null,
      departmentIds: [],
      primaryDepartmentId: null,
    },
    entityToForm: toEmployeeFormData,
    formToPayload: (form) => toEmployeePayload(form),
    getEntityName: (employee) => employee.name,
    transformData: (data) => data.map(toEmployeeProfile),
    paginationOptions: {
      initialSortBy: 'createdAt',
      initialSortOrder: 'desc',
      extraParams: filter.apiParams,
    },
  });

  // 当部门选择变化时，自动设置主部门
  useEffect(() => {
    const deptIds = crud.formData.departmentIds;
    if (!deptIds || deptIds.length === 0) {
      if (crud.formData.primaryDepartmentId) {
        crud.updateFormField('primaryDepartmentId', null);
      }
    } else if (deptIds.length === 1) {
      if (crud.formData.primaryDepartmentId !== deptIds[0]) {
        crud.updateFormField('primaryDepartmentId', deptIds[0]);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 仅在 departmentIds 变化时触发，避免循环更新
  }, [crud.formData.departmentIds]);

  // 表格列：从 `employeeResponseSchema` 派生 header/width/sortable。
  // status/gender/loginStatus 已走 schema statusBadge 自动渲染。
  // 身份 Badge + 钉钉激活着色 + 日期本地化格式保留在 overrides 中。
  const columns = useMemo(
    () =>
      deriveColumnsFromSchema<EmployeeProfile>(employeeResponseSchema, {
        exclude: ['avatar'],
        overrides: [
          {
            key: 'avatar',
            mode: 'before',
            header: '头像',
            width: 64,
            align: 'center',
            resizable: false,
            render: (employee) => (
              <EmployeeAvatar src={employee.avatar} name={employee.name} size="sm" />
            ),
          },
          {
            key: 'id',
            render: (employee) => (
              <span className="font-mono text-muted-foreground">{employee.id}</span>
            ),
          },
          {
            key: 'jobNumber',
            render: (employee) => (
              <span className="text-muted-foreground">{employee.jobNumber || '-'}</span>
            ),
          },
          {
            key: 'departmentName',
            render: (employee) => (
              <span className="text-muted-foreground">{employee.departmentName || '-'}</span>
            ),
          },
          {
            key: 'departments',
            render: (employee) => (
              <span className="text-muted-foreground">{employee.departmentNames || '-'}</span>
            ),
          },
          {
            key: 'position',
            render: (employee) => (
              <span className="text-muted-foreground">{employee.position || '-'}</span>
            ),
          },
          {
            key: 'hourlyRate',
            render: (employee) => (
              <span className="font-mono text-muted-foreground">
                {formatHourlyRate(employee.hourlyRate)}
              </span>
            ),
          },
          {
            key: 'isAdmin',
            render: (employee) => {
              const labels = getIdentityLabels(employee);
              if (labels.length === 0) {
                return <span className="text-muted-foreground">-</span>;
              }
              return (
                <div className="flex flex-wrap gap-1">
                  {labels.map((label) => (
                    <Badge key={label} variant="secondary">
                      {label}
                    </Badge>
                  ))}
                </div>
              );
            },
          },
          {
            key: 'phone',
            render: (employee) => (
              <span className="text-muted-foreground">{employee.phone || '-'}</span>
            ),
          },
          {
            key: 'email',
            render: (employee) => (
              <span className="text-muted-foreground">{employee.email || '-'}</span>
            ),
          },
          {
            key: 'workPlace',
            render: (employee) => (
              <span className="text-muted-foreground">{employee.workPlace || '-'}</span>
            ),
          },
          {
            key: 'dingtalkActive',
            render: (employee) => (
              <span
                className={employee.dingtalkActive ? 'text-green-600' : 'text-muted-foreground'}
              >
                {employee.dingtalkActive ? '已激活' : '未激活'}
              </span>
            ),
          },
          {
            key: 'username',
            render: (employee) => (
              <span className="font-medium">{employee.username || '未开通'}</span>
            ),
          },
          {
            key: 'loginStatus',
            render: (employee) =>
              employee.loginStatus ? (
                <StatusBadge status={employee.loginStatus} statusMap={loginStatusMap} />
              ) : (
                <span className="text-muted-foreground">-</span>
              ),
          },
          {
            key: 'canLogin',
            render: (employee) => (
              <span className={employee.canLogin ? 'text-green-600' : 'text-muted-foreground'}>
                {formatBoolean(employee.canLogin)}
              </span>
            ),
          },
          {
            key: 'lastLoginAt',
            render: (employee) => (
              <span className="text-muted-foreground">{formatDateTime(employee.lastLoginAt)}</span>
            ),
          },
          {
            key: 'lastLoginIp',
            render: (employee) => (
              <span className="text-muted-foreground">{employee.lastLoginIp || '-'}</span>
            ),
          },
          {
            key: 'loginFailCount',
            render: (employee) => (
              <span className="font-mono text-muted-foreground">
                {employee.loginFailCount ?? 0}
              </span>
            ),
          },
          {
            key: 'lockUntil',
            render: (employee) => (
              <span className="text-muted-foreground">{formatDateTime(employee.lockUntil)}</span>
            ),
          },
          {
            key: 'tokenInvalidAfter',
            render: (employee) => (
              <span className="text-muted-foreground">
                {formatDateTime(employee.tokenInvalidAfter)}
              </span>
            ),
          },
          {
            key: 'dingtalkUserId',
            render: (employee) => (
              <span className="font-mono text-muted-foreground">
                {employee.dingtalkUserId || '-'}
              </span>
            ),
          },
          {
            key: 'dingtalkUnionId',
            render: (employee) => (
              <span className="font-mono text-muted-foreground">
                {employee.dingtalkUnionId || '-'}
              </span>
            ),
          },
          {
            key: 'dingtalkExtension',
            render: (employee) => (
              <span className="text-muted-foreground">
                {employee.dingtalkExtension ? '有' : '-'}
              </span>
            ),
          },
          {
            key: 'lastSyncAt',
            render: (employee) => (
              <span className="text-muted-foreground">{formatDateTime(employee.lastSyncAt)}</span>
            ),
          },
          {
            key: 'createdAt',
            render: (employee) => (
              <span className="text-muted-foreground">{formatDateTime(employee.createdAt)}</span>
            ),
          },
          {
            key: 'createdBy',
            render: (employee) => (
              <span className="font-mono text-muted-foreground">{employee.createdBy || '-'}</span>
            ),
          },
          {
            key: 'updatedAt',
            render: (employee) => (
              <span className="text-muted-foreground">{formatDateTime(employee.updatedAt)}</span>
            ),
          },
          {
            key: 'updatedBy',
            render: (employee) => (
              <span className="font-mono text-muted-foreground">{employee.updatedBy || '-'}</span>
            ),
          },
          {
            key: 'deletedAt',
            render: (employee) => (
              <span className="text-muted-foreground">{formatDateTime(employee.deletedAt)}</span>
            ),
          },
          {
            key: 'version',
            render: (employee) => (
              <span className="font-mono text-muted-foreground">{employee.version ?? '-'}</span>
            ),
          },
          {
            key: 'entryDate',
            render: (employee) => (
              <span className="text-muted-foreground">{formatDate(employee.entryDate)}</span>
            ),
          },
        ],
      }),
    []
  );

  const rowActions = useMemo(
    () =>
      createStandardActions<EmployeeProfile>({
        onView: crud.openViewDialog,
        onEdit: crud.openEditDialog,
        onDelete: crud.openDeleteDialog,
        hideEdit: !canEdit,
        hideDelete: !canDelete,
      }),
    [crud.openViewDialog, crud.openEditDialog, crud.openDeleteDialog, canEdit, canDelete]
  );

  const renderMobileCard = (employee: EmployeeProfile) => (
    <GenericMobileCard
      title={employee.name}
      status={<StatusBadge status={employee.status} statusMap={employeeStatusMap} />}
      fields={[
        { label: '工号', value: employee.serialNumber },
        { label: '部门', value: employee.departmentName || '-' },
        { label: '职位', value: employee.position || '-' },
        { label: '手机号', value: employee.phone || '-' },
      ]}
      footer={
        employee.entryDate
          ? `入职日期: ${new Date(employee.entryDate).toLocaleDateString('zh-CN')}`
          : undefined
      }
      onClick={() => crud.openViewDialog(employee)}
      testId={`employee-${employee.id}`}
    />
  );

  return (
    <MobileBottomBarSpacer hasBottomBar={isMobile}>
      <StandardLayout
        toolbar={
          <StandardToolbar
            onCreate={canCreate ? crud.openCreateDialog : undefined}
            createLabel="新建员工"
            onSearch={() => {
              filter.search();
              setTimeout(() => crud.refresh(), 0);
            }}
            onReset={() => {
              filter.reset();
              setTimeout(() => crud.refresh(), 0);
            }}
            bulkSelection={{
              selectedCount: crud.selectedKeys.size,
              onClearSelection: crud.clearSelection,
              onBulkDelete: crud.openBulkDeleteDialog,
            }}
            filters={
              scheme.isLoading ? (
                <FilterBarSkeleton count={3} />
              ) : (
                <div className="flex flex-wrap items-center gap-4">
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
                  {/* departmentId 走 legacy query 参数（M2M relation，不在 registry 里） */}
                  <div className="flex items-center gap-2">
                    <label className="whitespace-nowrap text-sm text-muted-foreground">部门</label>
                    <div className="w-36">
                      <DepartmentSelect
                        value={(filter.tempFilters.departmentId as string) ?? ''}
                        onChange={(val) =>
                          filter.setFilter('departmentId', typeof val === 'string' ? val : '')
                        }
                        placeholder="选择部门"
                        contentClassName="min-w-[300px] max-w-[calc(100vw-2rem)]"
                      />
                    </div>
                  </div>
                </div>
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
          hidePagination
          emptyState={{
            title: '暂无员工数据',
            description: '点击"新建员工"按钮添加您的第一位员工',
            icon: <Users className="h-12 w-12 text-muted-foreground/50" />,
          }}
        />

        <FormDialog
          {...crud.formDialogProps}
          variant="drawer"
          title={crud.isEditing ? '员工详情' : '新建员工'}
          onSubmit={crud.handleSubmit}
        >
          <div className="col-span-1 space-y-6 py-4 md:col-span-2">
            <div className={cn('grid gap-4', !isMobile && 'grid-cols-2')}>
              {/* 姓名 */}
              <FormField
                name="name"
                label="姓名"
                required
                error={crud.getFieldError('name')}
                viewContent={crud.formData.name}
              >
                <Input
                  id="name"
                  placeholder="请输入姓名"
                  value={crud.formData.name}
                  onChange={(e) => crud.updateFormField('name', e.target.value)}
                />
              </FormField>

              {/* 手机号 */}
              <FormField
                name="phone"
                label="手机号"
                error={crud.getFieldError('phone')}
                viewContent={crud.formData.phone}
              >
                <Input
                  id="phone"
                  placeholder="请输入手机号"
                  value={crud.formData.phone ?? ''}
                  onChange={(e) => crud.updateFormField('phone', e.target.value || null)}
                />
              </FormField>

              {/* 邮箱 */}
              <FormField
                name="email"
                label="邮箱"
                error={crud.getFieldError('email')}
                viewContent={crud.formData.email}
              >
                <Input
                  id="email"
                  placeholder="请输入邮箱"
                  value={crud.formData.email ?? ''}
                  onChange={(e) => crud.updateFormField('email', e.target.value || null)}
                />
              </FormField>

              {/* 性别 */}
              <FormField
                name="gender"
                label="性别"
                error={crud.getFieldError('gender')}
                viewContent={
                  crud.formData.gender ? (
                    <StatusBadge status={crud.formData.gender} statusMap={genderMap} />
                  ) : undefined
                }
              >
                <SelectRoot
                  value={crud.formData.gender ?? ''}
                  onValueChange={(val) => crud.updateFormField('gender', val || null)}
                >
                  <SelectTrigger id="gender">
                    <SelectValue placeholder="请选择性别" />
                  </SelectTrigger>
                  <SelectContent>
                    {GENDER_OPTIONS.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </SelectRoot>
              </FormField>

              {/* 职位 */}
              <FormField
                name="position"
                label="职位"
                error={crud.getFieldError('position')}
                viewContent={crud.formData.position}
              >
                <SelectRoot
                  value={crud.formData.position ?? ''}
                  onValueChange={(val) => crud.updateFormField('position', val || null)}
                >
                  <SelectTrigger id="position">
                    <SelectValue placeholder="请选择职位" />
                  </SelectTrigger>
                  <SelectContent>
                    {POSITION_OPTIONS.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </SelectRoot>
              </FormField>

              {/* 工时单价 */}
              <FormField
                name="hourlyRate"
                label="工时单价"
                error={crud.getFieldError('hourlyRate')}
                viewContent={formatHourlyRate(crud.formData.hourlyRate as number | null)}
              >
                <Input
                  id="hourlyRate"
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="请输入工时单价"
                  value={crud.formData.hourlyRate ?? ''}
                  onChange={(e) =>
                    crud.updateFormField(
                      'hourlyRate',
                      e.target.value === '' ? null : Number(e.target.value)
                    )
                  }
                />
              </FormField>

              {/* 状态 */}
              <FormField
                name="status"
                label="状态"
                error={crud.getFieldError('status')}
                viewContent={
                  <StatusBadge
                    status={crud.formData.status ?? EMPLOYEE_STATUS.ACTIVE}
                    statusMap={employeeStatusMap}
                  />
                }
              >
                <SelectRoot
                  value={crud.formData.status ?? EMPLOYEE_STATUS.ACTIVE}
                  onValueChange={(val) => crud.updateFormField('status', val)}
                >
                  <SelectTrigger id="status">
                    <SelectValue placeholder="请选择状态" />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(EMPLOYEE_STATUS_LABELS).map(([value, label]) => (
                      <SelectItem key={value} value={value}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </SelectRoot>
              </FormField>

              {/* 入职日期 */}
              <FormField
                name="entryDate"
                label="入职日期"
                error={crud.getFieldError('entryDate')}
                viewContent={formatDateDisplay(crud.formData.entryDate) || undefined}
              >
                <DatePicker
                  date={parseLocalDateString(crud.formData.entryDate?.slice(0, 10))}
                  onDateChange={(d) =>
                    crud.updateFormField('entryDate', d ? formatDateToLocalDateString(d) : null)
                  }
                  className="w-full"
                />
              </FormField>

              {/* 头像 */}
              <FormField
                name="avatar"
                label="头像"
                error={crud.getFieldError('avatar')}
                viewContent={
                  <EmployeeAvatar src={crud.formData.avatar} name={crud.formData.name} size="lg" />
                }
              >
                <div className="flex items-center gap-3">
                  <EmployeeAvatar src={crud.formData.avatar} name={crud.formData.name} size="sm" />
                  <Input
                    id="avatar"
                    placeholder="请输入头像 URL"
                    value={crud.formData.avatar ?? ''}
                    onChange={(e) => crud.updateFormField('avatar', e.target.value || null)}
                  />
                </div>
              </FormField>

              {/* 所属部门 */}
              <FormField
                name="departmentIds"
                label="所属部门"
                error={crud.getFieldError('departmentIds')}
                viewContent={crud.editingEntity?.departments
                  ?.map((d) => d.departmentName)
                  .join(', ')}
              >
                <DepartmentSelect
                  value={crud.formData.departmentIds ?? []}
                  onChange={(val) =>
                    crud.updateFormField('departmentIds', Array.isArray(val) ? val : [val])
                  }
                  multiple
                  placeholder="选择所属部门"
                />
              </FormField>

              {/* 主部门 */}
              <FormField
                name="primaryDepartmentId"
                label="主部门"
                error={crud.getFieldError('primaryDepartmentId')}
                viewContent={crud.editingEntity?.primaryDepartment?.departmentName}
              >
                <DepartmentSelect
                  value={crud.formData.primaryDepartmentId ?? ''}
                  onChange={(val) =>
                    crud.updateFormField(
                      'primaryDepartmentId',
                      (typeof val === 'string' ? val : '') || null
                    )
                  }
                  placeholder="选择主部门"
                />
              </FormField>
            </div>

            {/* 同步信息（查看/编辑模式展示，编辑态强制只读） */}
            {crud.editingEntity && (
              <div className="space-y-3 border-t pt-4">
                <h4 className="text-sm font-medium text-muted-foreground">基础只读信息</h4>
                <div className={cn('grid gap-4', !isMobile && 'grid-cols-2')}>
                  <ReadOnlyFormField name="id" label="ID" viewContent={crud.editingEntity.id} />
                  <ReadOnlyFormField
                    name="serialNumber"
                    label="工号"
                    viewContent={crud.editingEntity.serialNumber}
                  />
                  <ReadOnlyFormField
                    name="departmentNames"
                    label="所属部门"
                    viewContent={crud.editingEntity.departmentNames}
                  />
                </div>
              </div>
            )}

            {crud.editingEntity && (
              <div className="space-y-3 border-t pt-4">
                <h4 className="text-sm font-medium text-muted-foreground">登录账号信息</h4>
                <div className={cn('grid gap-4', !isMobile && 'grid-cols-2')}>
                  <ReadOnlyFormField
                    name="username"
                    label="登录用户名"
                    viewContent={crud.editingEntity.username}
                  />
                  <ReadOnlyFormField
                    name="loginStatus"
                    label="登录状态"
                    viewContent={
                      crud.editingEntity.loginStatus ? (
                        <StatusBadge
                          status={crud.editingEntity.loginStatus}
                          statusMap={loginStatusMap}
                        />
                      ) : undefined
                    }
                  />
                  <ReadOnlyFormField
                    name="canLogin"
                    label="可登录"
                    viewContent={formatBoolean(crud.editingEntity.canLogin)}
                  />
                  <ReadOnlyFormField
                    name="loginFailCount"
                    label="登录失败次数"
                    viewContent={String(crud.editingEntity.loginFailCount ?? 0)}
                  />
                  <ReadOnlyFormField
                    name="lastLoginAt"
                    label="最后登录"
                    viewContent={formatDateTime(crud.editingEntity.lastLoginAt)}
                  />
                  <ReadOnlyFormField
                    name="lastLoginIp"
                    label="最后登录IP"
                    viewContent={crud.editingEntity.lastLoginIp}
                  />
                  <ReadOnlyFormField
                    name="lockUntil"
                    label="锁定到"
                    viewContent={formatDateTime(crud.editingEntity.lockUntil)}
                  />
                  <ReadOnlyFormField
                    name="tokenInvalidAfter"
                    label="令牌失效点"
                    viewContent={formatDateTime(crud.editingEntity.tokenInvalidAfter)}
                  />
                </div>
              </div>
            )}

            {/* 同步信息（查看/编辑模式展示，编辑态强制只读） */}
            {crud.editingEntity && (
              <div className="space-y-3 border-t pt-4">
                <h4 className="text-sm font-medium text-muted-foreground">钉钉同步信息</h4>
                <div className={cn('grid gap-4', !isMobile && 'grid-cols-2')}>
                  <ReadOnlyFormField
                    name="dingtalkUserId"
                    label="钉钉用户ID"
                    viewContent={crud.editingEntity.dingtalkUserId}
                  />
                  <ReadOnlyFormField
                    name="dingtalkUnionId"
                    label="钉钉 UnionId"
                    viewContent={crud.editingEntity.dingtalkUnionId}
                  />
                  <ReadOnlyFormField
                    name="jobNumber"
                    label="钉钉工号"
                    viewContent={crud.editingEntity.jobNumber}
                  />
                  <ReadOnlyFormField
                    name="workPlace"
                    label="办公地点"
                    viewContent={crud.editingEntity.workPlace}
                  />
                  <ReadOnlyFormField
                    name="isAdmin"
                    label="钉钉管理员"
                    viewContent={formatBoolean(crud.editingEntity.isAdmin)}
                  />
                  <ReadOnlyFormField
                    name="isBoss"
                    label="钉钉老板"
                    viewContent={formatBoolean(crud.editingEntity.isBoss)}
                  />
                  <ReadOnlyFormField
                    name="isLeader"
                    label="钉钉主管"
                    viewContent={formatBoolean(crud.editingEntity.isLeader)}
                  />
                  <ReadOnlyFormField
                    name="dingtalkActive"
                    label="钉钉活跃状态"
                    viewContent={
                      crud.editingEntity.dingtalkActive !== undefined
                        ? crud.editingEntity.dingtalkActive
                          ? '活跃'
                          : '非活跃'
                        : undefined
                    }
                  />
                  <ReadOnlyFormField
                    name="lastSyncAt"
                    label="最后同步时间"
                    viewContent={formatDateTime(crud.editingEntity.lastSyncAt)}
                  />
                  <ReadOnlyFormField
                    name="dingtalkExtension"
                    label="钉钉扩展信息"
                    className={!isMobile ? 'col-span-2' : undefined}
                    viewContent={
                      <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all text-xs">
                        {formatJson(crud.editingEntity.dingtalkExtension)}
                      </pre>
                    }
                  />
                </div>
              </div>
            )}

            {crud.editingEntity && (
              <div className="space-y-3 border-t pt-4">
                <h4 className="text-sm font-medium text-muted-foreground">审计信息</h4>
                <div className={cn('grid gap-4', !isMobile && 'grid-cols-2')}>
                  <ReadOnlyFormField
                    name="createdAt"
                    label="创建时间"
                    viewContent={formatDateTime(crud.editingEntity.createdAt)}
                  />
                  <ReadOnlyFormField
                    name="createdBy"
                    label="创建人ID"
                    viewContent={crud.editingEntity.createdBy}
                  />
                  <ReadOnlyFormField
                    name="updatedAt"
                    label="更新时间"
                    viewContent={formatDateTime(crud.editingEntity.updatedAt)}
                  />
                  <ReadOnlyFormField
                    name="updatedBy"
                    label="更新人ID"
                    viewContent={crud.editingEntity.updatedBy}
                  />
                  <ReadOnlyFormField
                    name="deletedAt"
                    label="删除时间"
                    viewContent={formatDateTime(crud.editingEntity.deletedAt)}
                  />
                  <ReadOnlyFormField
                    name="version"
                    label="版本"
                    viewContent={String(crud.editingEntity.version ?? '-')}
                  />
                </div>
              </div>
            )}
          </div>
        </FormDialog>

        <DeleteConfirm {...crud.deleteConfirmProps} />
        <BulkDeleteConfirm {...crud.bulkDeleteConfirmProps} />
      </StandardLayout>
      {isMobile && canCreate && (
        <MobileBottomBar>
          <Button className="flex-1" onClick={crud.openCreateDialog}>
            <Plus className="mr-2 h-4 w-4" />
            新建员工
          </Button>
        </MobileBottomBar>
      )}
    </MobileBottomBarSpacer>
  );
}
