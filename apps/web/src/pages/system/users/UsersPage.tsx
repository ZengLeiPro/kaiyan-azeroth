// 触发内置渲染器注册（副作用 import）
import '@/lib/column-renderers';

import { userResponseSchema } from '@ky-azeroth/shared/schemas/auth';
import { Plus, UserCheck, UserX } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';

import { MobileBottomBar, MobileBottomBarSpacer } from '@/components/mobile';
import { ResponsiveDialog } from '@/components/mobile/ResponsiveDialog';
import { BulkDeleteConfirm } from '@/components/patterns/bulk-delete-confirm';
import { CrudTable } from '@/components/patterns/crud-table';
import { DeleteConfirm } from '@/components/patterns/delete-confirm';
import { FormDialog } from '@/components/patterns/form-dialog';
import { FormField } from '@/components/patterns/form-field';
import { GenericMobileCard } from '@/components/patterns/generic-mobile-card';
import { PersonalFilterControls } from '@/components/patterns/personal-filter-controls';
import { createStandardActions } from '@/components/patterns/row-actions-helpers';
import { StandardToolbar } from '@/components/patterns/standard-toolbar';
import { StandardLayout } from '@/components/templates/standard-layout';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { MultiSelect, Select } from '@/components/ui/select';
import { useCrud } from '@/hooks/use-crud';
import { useFilterScheme } from '@/hooks/use-filter-scheme';
import { useManualFilter } from '@/hooks/use-manual-filter';
import { useIsMobile } from '@/hooks/use-mobile';
import { api, getErrorMessage } from '@/lib/api';
import { deriveColumnsFromSchema } from '@/lib/columns-from-schema';
import { formatDateTimeDisplay } from '@/lib/date-utils';
import { logger } from '@/lib/logger';

import {
  EmployeeForUser,
  RoleForUser,
  toUserFormData,
  User,
  UserFormData,
  userFormSchema,
} from './types';
import { useSensitiveActionReauthentication } from './use-sensitive-action-reauthentication';

// 用户状态选项
const statusOptions = [
  { value: 'active', label: '启用' },
  { value: 'disabled', label: '禁用' },
];

// 筛选条件初始值
const initialFilters = {
  keyword: '',
  status: [] as string[],
  roleId: [] as string[],
};

export function UsersPage() {
  const isMobile = useIsMobile();
  const [roles, setRoles] = useState<RoleForUser[]>([]);
  const [employees, setEmployees] = useState<EmployeeForUser[]>([]);
  const [statusDialogOpen, setStatusDialogOpen] = useState(false);
  const [targetUser, setTargetUser] = useState<User | null>(null);
  const reauthentication = useSensitiveActionReauthentication();

  const scheme = useFilterScheme('system.users');

  // 保留现有用户查询 DTO 参数，个人配置只控制手写控件的显示与顺序。
  const filter = useManualFilter(
    initialFilters,
    (filters) => ({
      keyword: filters.keyword || undefined,
      status: filters.status.length ? filters.status : undefined,
      roleId: filters.roleId.length ? filters.roleId : undefined,
    }),
    scheme.version
  );

  useEffect(() => {
    const loadData = async () => {
      try {
        const [rolesRes, employeesRes] = await Promise.all([
          api.get('/roles'),
          api.get('/employees/all'),
        ]);
        setRoles(rolesRes.data.items);
        setEmployees(employeesRes.data);
      } catch (error) {
        logger.error('UsersPage', '加载基础数据失败', error);
      }
    };
    loadData();
  }, []);

  const roleOptions = useMemo(() => roles.map((r) => ({ value: r.id, label: r.name })), [roles]);

  const crud = useCrud<User, UserFormData>({
    endpoint: '/users',
    schema: userFormSchema,
    validateMode: 'onSubmit',
    initialFormData: {
      id: undefined,
      username: '',
      phone: '',
      email: '',
      password: '',
      employeeId: '',
      roleIds: [],
    },
    entityToForm: toUserFormData,
    formToPayload: (form) => ({
      username: form.username,
      phone: form.phone || undefined,
      email: form.email || undefined,
      password: form.password || undefined,
      employeeId: form.employeeId || undefined,
      roleIds: form.roleIds,
    }),
    getEntityName: (user) => user.username,
    paginationOptions: {
      initialSortBy: 'createdAt',
      initialSortOrder: 'desc',
      extraParams: filter.apiParams,
    },
  });

  const handleUserSubmit = async () => {
    // 先复用 CRUD 校验展示表单错误，避免无效表单也要求管理员重新认证。
    if (!userFormSchema.safeParse(crud.formData).success) return crud.handleSubmit();
    return reauthentication.request(crud.handleSubmit);
  };

  const handleToggleStatus = (user: User) => {
    setTargetUser(user);
    setStatusDialogOpen(true);
  };

  const performToggleStatus = async () => {
    if (!targetUser) return;

    try {
      const newStatus = targetUser.status === 'active' ? 'disabled' : 'active';
      await api.patch(`/users/${targetUser.id}/status`, { status: newStatus });
      toast.success(newStatus === 'active' ? '用户已启用' : '用户已禁用');
      setStatusDialogOpen(false);
      setTargetUser(null);
      crud.refresh();
    } catch (error) {
      toast.error(getErrorMessage(error, '操作失败'));
    }
  };

  const confirmToggleStatus = () => {
    setStatusDialogOpen(false);
    return reauthentication.request(performToggleStatus);
  };

  const getStatusBadge = (status: string) => {
    if (status === 'active') {
      return <Badge className="bg-green-100 text-green-800 hover:bg-green-100">启用</Badge>;
    }
    return <Badge className="bg-gray-100 text-gray-800 hover:bg-gray-100">禁用</Badge>;
  };

  /**
   * 列定义：从 `userResponseSchema` 派生列头/宽度/sortable，业务 render 在 overrides。
   * Badge（角色/状态/关联员工）均为页面级业务渲染。
   */
  const columns = useMemo(
    () =>
      deriveColumnsFromSchema<User>(userResponseSchema, {
        include: [
          'username',
          'phone',
          'email',
          'employee',
          'roles',
          'status',
          'createdAt',
          'lastLoginAt',
          'lastLoginIp',
        ],
        overrides: [
          {
            key: 'username',
            render: (user) => <span className="font-medium">{user.username}</span>,
          },
          {
            key: 'phone',
            render: (user) => user.phone || '-',
          },
          {
            key: 'email',
            render: (user) => <span className="text-muted-foreground">{user.email || '-'}</span>,
          },
          {
            key: 'employee',
            render: (user) => user.employee?.name || '-',
          },
          {
            key: 'roles',
            render: (user) => (
              <div className="flex flex-wrap gap-1">
                {user.roles.map((role, index) => (
                  <Badge key={`${role.id}-${index}`} variant="outline">
                    {role.name}
                  </Badge>
                ))}
              </div>
            ),
          },
          {
            key: 'createdAt',
            render: (user) => (
              <span className="text-muted-foreground">
                {formatDateTimeDisplay(user.createdAt) || '-'}
              </span>
            ),
          },
          {
            key: 'lastLoginAt',
            render: (user) => (
              <span className="text-muted-foreground">
                {formatDateTimeDisplay(user.lastLoginAt) || '-'}
              </span>
            ),
          },
          {
            key: 'lastLoginIp',
            render: (user) => (
              <span className="text-muted-foreground">{user.lastLoginIp || '-'}</span>
            ),
          },
        ],
      }),
    []
  );

  const rowActions = useMemo(
    () =>
      createStandardActions<User>({
        onView: crud.openViewDialog,
        onEdit: crud.openEditDialog,
        onDelete: crud.openDeleteDialog,
      }),
    [crud.openViewDialog, crud.openEditDialog, crud.openDeleteDialog]
  );

  const renderMobileCard = (user: User) => (
    <GenericMobileCard
      title={user.username}
      status={getStatusBadge(user.status)}
      fields={[
        { label: '手机', value: user.phone || '-' },
        { label: '邮箱', value: user.email || '-' },
        {
          label: '角色',
          value: (
            <div className="flex flex-wrap gap-1">
              {user.roles.map((role, index) => (
                <Badge key={`${role.id}-${index}`} variant="outline" className="text-xs">
                  {role.name}
                </Badge>
              ))}
            </div>
          ),
        },
        ...(user.employee ? [{ label: '关联员工', value: user.employee.name }] : []),
      ]}
      onClick={() => crud.openViewDialog(user)}
      testId={`user-${user.id}`}
    />
  );

  const configuredFieldKeys = scheme.config?.fields.map((item) => item.fieldKey) ?? [
    'status',
    'roleId',
  ];

  const renderFilterField = (fieldKey: string) => {
    switch (fieldKey) {
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
      case 'roleId':
        return (
          <div className="flex items-center gap-2">
            <label className="whitespace-nowrap text-sm text-muted-foreground">角色</label>
            <MultiSelect
              value={filter.tempFilters.roleId}
              onChange={(vs) => filter.setFilter('roleId', vs)}
              options={roleOptions}
              placeholder="全部"
              className="h-9 w-36"
              contentClassName="min-w-[240px] max-w-[calc(100vw-2rem)]"
            />
          </div>
        );
      default:
        return null;
    }
  };

  return (
    <MobileBottomBarSpacer hasBottomBar={isMobile}>
      <StandardLayout
        toolbar={
          <StandardToolbar
            onCreate={crud.openCreateDialog}
            createLabel="新建用户"
            bulkSelection={{
              selectedCount: crud.selectedKeys.size,
              onClearSelection: crud.clearSelection,
              onBulkDelete: crud.openBulkDeleteDialog,
            }}
            onSearch={filter.search}
            onReset={filter.reset}
            filters={
              <div className="flex flex-wrap items-center gap-4">
                {(scheme.config?.keyword.enabled ?? true) && (
                  <div className="flex items-center gap-2">
                    <label className="whitespace-nowrap text-sm text-muted-foreground">
                      关键词
                    </label>
                    <Input
                      value={filter.tempFilters.keyword}
                      onChange={(e) => filter.setFilter('keyword', e.target.value)}
                      placeholder={scheme.config?.keyword.placeholder ?? '用户名/手机号/邮箱'}
                      className="h-9 w-40"
                    />
                  </div>
                )}
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
          actions={rowActions}
          loading={crud.loading}
          sorting={crud.sorting}
          onRowClick={crud.openViewDialog}
          renderMobileCard={renderMobileCard}
          rowSelection={crud.rowSelectionProps}
          hidePagination
          emptyState={{
            title: '暂无用户数据',
            description: '点击"新建用户"添加第一条记录',
          }}
        />

        <FormDialog
          {...crud.formDialogProps}
          variant="drawer"
          title={crud.isEditing ? '用户详情' : '新建用户'}
          onSubmit={handleUserSubmit}
        >
          <>
            <FormField
              name="username"
              label="用户名"
              required
              error={crud.getFieldError('username')}
              viewContent={crud.formData.username}
            >
              <Input
                id="username"
                data-testid="user-username-input"
                placeholder="用于登录的用户名"
                value={crud.formData.username}
                onChange={(e) => crud.updateFormField('username', e.target.value)}
                disabled={crud.isEditing}
                autoComplete="off"
              />
            </FormField>

            <FormField
              name="phone"
              label="手机号"
              required
              error={crud.getFieldError('phone')}
              viewContent={crud.formData.phone}
            >
              <Input
                id="phone"
                data-testid="user-phone-input"
                placeholder="11位手机号码"
                value={crud.formData.phone}
                onChange={(e) => crud.updateFormField('phone', e.target.value)}
              />
            </FormField>

            <FormField
              name="email"
              label="邮箱"
              error={crud.getFieldError('email')}
              viewContent={crud.formData.email}
            >
              <Input
                id="email"
                type="email"
                data-testid="user-email-input"
                placeholder="user@example.com"
                value={crud.formData.email}
                onChange={(e) => crud.updateFormField('email', e.target.value)}
                autoComplete="email"
              />
            </FormField>

            {!crud.isViewMode && (
              <FormField
                name="password"
                label={`密码 ${crud.isEditing ? '(留空不修改)' : ''}`}
                required={!crud.isEditing}
                error={crud.getFieldError('password')}
              >
                <Input
                  id="password"
                  type="password"
                  data-testid="user-password-input"
                  placeholder={crud.isEditing ? '留空保持原密码' : '请输入密码'}
                  value={crud.formData.password}
                  onChange={(e) => crud.updateFormField('password', e.target.value)}
                  autoComplete="new-password"
                />
              </FormField>
            )}

            <FormField
              name="employeeId"
              label="关联员工"
              error={crud.getFieldError('employeeId')}
              viewContent={
                employees.find((e) => e.id === crud.formData.employeeId)?.name || '未关联'
              }
            >
              <Select
                data-testid="user-employee-select"
                options={[
                  { value: '', label: '不关联员工' },
                  ...employees.map((emp) => ({
                    value: emp.id,
                    label: emp.serialNumber ? `${emp.name} (${emp.serialNumber})` : emp.name,
                  })),
                ]}
                value={crud.formData.employeeId}
                onChange={(value) => crud.updateFormField('employeeId', value)}
                placeholder="选择员工"
              />
            </FormField>

            <FormField
              name="roleIds"
              label="用户角色"
              required
              fullRow
              error={crud.getFieldError('roleIds')}
              viewContent={
                <div className="flex min-h-[40px] flex-wrap items-center gap-1 rounded-md bg-muted/50 px-3 py-2">
                  {crud.formData.roleIds.length > 0 ? (
                    crud.formData.roleIds.map((roleId) => {
                      const role = roles.find((r) => r.id === roleId);
                      return role ? (
                        <Badge key={roleId} variant="outline">
                          {role.name}
                        </Badge>
                      ) : null;
                    })
                  ) : (
                    <span className="text-sm text-muted-foreground">未分配角色</span>
                  )}
                </div>
              }
            >
              <MultiSelect
                data-testid="user-roles-select"
                options={roles.map((role) => ({
                  value: role.id,
                  label: role.name,
                }))}
                value={crud.formData.roleIds}
                onChange={(value) => crud.updateFormField('roleIds', value)}
                placeholder="选择角色"
              />
            </FormField>

            {crud.isEditing && crud.editingEntity && (
              <div className="col-span-1 border-t pt-4 md:col-span-2">
                <Button
                  type="button"
                  variant={crud.editingEntity.status === 'active' ? 'destructive' : 'default'}
                  className="w-full"
                  onClick={() => {
                    crud.closeDialog();
                    handleToggleStatus(crud.editingEntity!);
                  }}
                >
                  {crud.editingEntity.status === 'active' ? (
                    <>
                      <UserX className="mr-2 h-4 w-4" />
                      禁用用户
                    </>
                  ) : (
                    <>
                      <UserCheck className="mr-2 h-4 w-4" />
                      启用用户
                    </>
                  )}
                </Button>
              </div>
            )}
          </>
        </FormDialog>

        <ResponsiveDialog
          open={reauthentication.dialogOpen}
          onOpenChange={reauthentication.onDialogOpenChange}
          title="验证当前管理员身份"
          description="用户账号变更属于高风险操作，请输入您自己的登录密码继续。"
          desktopMaxWidth="max-w-md"
          modal
          footer={
            <>
              <Button
                variant="outline"
                onClick={reauthentication.cancel}
                disabled={reauthentication.loading}
              >
                取消
              </Button>
              <Button
                onClick={reauthentication.confirm}
                disabled={reauthentication.password.length < 6 || reauthentication.loading}
                data-testid="confirm-reauthentication-btn"
              >
                {reauthentication.loading ? '验证中...' : '验证并继续'}
              </Button>
            </>
          }
        >
          <Input
            type="password"
            value={reauthentication.password}
            onChange={(event) => reauthentication.setPassword(event.target.value)}
            onKeyDown={(event) => {
              if (
                event.key === 'Enter' &&
                reauthentication.password.length >= 6 &&
                !reauthentication.loading
              ) {
                void reauthentication.confirm();
              }
            }}
            placeholder="请输入您自己的登录密码"
            autoComplete="current-password"
            autoFocus
            data-testid="reauthentication-password-input"
          />
        </ResponsiveDialog>

        <ResponsiveDialog
          open={statusDialogOpen}
          onOpenChange={setStatusDialogOpen}
          title={targetUser?.status === 'active' ? '禁用用户' : '启用用户'}
          footer={
            <>
              <Button variant="outline" onClick={() => setStatusDialogOpen(false)}>
                取消
              </Button>
              <Button
                variant={targetUser?.status === 'active' ? 'destructive' : 'default'}
                onClick={confirmToggleStatus}
                data-testid="confirm-toggle-status-btn"
              >
                确认
              </Button>
            </>
          }
        >
          <p className="py-4">
            {targetUser?.status === 'active' ? (
              <>
                确定要禁用用户 <strong>{targetUser?.username}</strong>{' '}
                吗？禁用后该用户将无法登录系统。
              </>
            ) : (
              <>
                确定要启用用户 <strong>{targetUser?.username}</strong> 吗？
              </>
            )}
          </p>
        </ResponsiveDialog>
        <DeleteConfirm
          {...crud.deleteConfirmProps}
          onConfirm={() => {
            crud.deleteConfirmProps.onOpenChange(false);
            return reauthentication.request(crud.handleDelete);
          }}
        />
        <BulkDeleteConfirm
          {...crud.bulkDeleteConfirmProps}
          onConfirm={() => {
            crud.bulkDeleteConfirmProps.onOpenChange(false);
            return reauthentication.request(crud.handleBulkDelete);
          }}
        />
      </StandardLayout>
      {isMobile && (
        <MobileBottomBar>
          <Button className="flex-1" onClick={crud.openCreateDialog}>
            <Plus className="mr-2 h-4 w-4" />
            新建用户
          </Button>
        </MobileBottomBar>
      )}
    </MobileBottomBarSpacer>
  );
}
