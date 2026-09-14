// 触发内置渲染器注册（副作用 import）
import '@/lib/column-renderers';

import { roleResponseSchema } from '@ky-azeroth/shared/schemas/auth';
import { Plus, Shield } from 'lucide-react';
import React, { useEffect, useMemo, useState } from 'react';

import { MobileBottomBar, MobileBottomBarSpacer } from '@/components/mobile';
import { BulkDeleteConfirm } from '@/components/patterns/bulk-delete-confirm';
import { CrudFilterBar } from '@/components/patterns/crud-filter-bar';
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
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  MultiSelect,
  SelectContent,
  SelectItem,
  SelectRoot,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { useCrud } from '@/hooks/use-crud';
import { useFilterScheme } from '@/hooks/use-filter-scheme';
import { useManualFilter } from '@/hooks/use-manual-filter';
import { useIsMobile } from '@/hooks/use-mobile';
import { api } from '@/lib/api';
import { deriveColumnsFromSchema } from '@/lib/columns-from-schema';
import { formatDateTimeDisplay } from '@/lib/date-utils';
import { cn } from '@/lib/utils';

import {
  type PermissionAction,
  permissionLabels,
  permissionModules,
  type RoleFormData,
  roleFormSchema,
  type RoleProfile,
  toRoleFormData,
  toRolePayload,
} from './types';

interface RoleUserOption {
  id: string;
  name: string;
  serialNumber: string;
}

export function RolesPage() {
  const isMobile = useIsMobile();
  const [users, setUsers] = useState<RoleUserOption[]>([]);

  // 筛选字段 + 初始 state 全由服务端的 filter-scheme registry/config 驱动。
  const scheme = useFilterScheme('system.roles');
  const filter = useManualFilter(scheme.initialFilters, undefined, scheme.version);

  useEffect(() => {
    void api.get<RoleUserOption[]>('/employees/all').then((res) => setUsers(res.data));
  }, []);

  const crud = useCrud<RoleProfile, RoleFormData>({
    endpoint: '/roles',
    schema: roleFormSchema,
    validateMode: 'onChange',
    initialFormData: {
      code: '',
      name: '',
      description: '',
      permissions: [],
      viewScopes: {},
      userIds: [],
    },
    entityToForm: toRoleFormData,
    formToPayload: (form) => toRolePayload(form),
    getEntityName: (role) => role.name,
    paginationOptions: {
      initialSortBy: 'createdAt',
      initialSortOrder: 'desc',
      extraParams: filter.apiParams,
    },
  });

  const userOptions = useMemo(
    () =>
      users.map((user) => ({
        value: user.id,
        label: user.serialNumber ? `${user.name} (${user.serialNumber})` : user.name,
      })),
    [users]
  );

  const togglePermission = (permissionKey: string) => {
    crud.setFormData((prev) => ({
      ...prev,
      permissions: prev.permissions.includes(permissionKey)
        ? prev.permissions.filter((p) => p !== permissionKey)
        : [...prev.permissions, permissionKey],
    }));
  };

  // 切换某模块下所有菜单的某个动作
  const toggleModuleAction = (
    moduleKey: string,
    menus: { key: string; permissions: PermissionAction[] }[],
    action: PermissionAction
  ) => {
    const menuPermKeys = menus
      .filter((m) => m.permissions.includes(action))
      .map((m) => `${moduleKey}:${m.key}:${action}`);
    const allChecked = menuPermKeys.every((key) => crud.formData.permissions.includes(key));

    crud.setFormData((prev) => ({
      ...prev,
      permissions: allChecked
        ? prev.permissions.filter((p) => !menuPermKeys.includes(p))
        : [...new Set([...prev.permissions, ...menuPermKeys])],
    }));
  };

  // 切换某模块下所有菜单的所有可用动作（全选/全取消）
  const toggleAllModulePermissions = (
    moduleKey: string,
    menus: { key: string; permissions: PermissionAction[] }[]
  ) => {
    const allPermKeys = menus.flatMap((m) =>
      m.permissions.map((a) => `${moduleKey}:${m.key}:${a}`)
    );
    const allChecked = allPermKeys.every((key) => crud.formData.permissions.includes(key));

    crud.setFormData((prev) => ({
      ...prev,
      permissions: allChecked
        ? prev.permissions.filter((p) => !allPermKeys.includes(p))
        : [...new Set([...prev.permissions, ...allPermKeys])],
    }));
  };

  /**
   * 列定义：从 `roleResponseSchema` 派生列头/宽度/sortable，业务 render 在 overrides。
   */
  const columns = deriveColumnsFromSchema<RoleProfile>(roleResponseSchema, {
    include: ['code', 'name', 'description', 'userCount', 'status', 'createdAt'],
    overrides: [
      {
        key: 'code',
        render: (role) => <Badge variant="outline">{role.code}</Badge>,
      },
      {
        key: 'description',
        render: (role) => <span className="text-muted-foreground">{role.description || '-'}</span>,
      },
      {
        key: 'userCount',
        render: (role) => <span>{role.userCount || 0}</span>,
      },
      {
        key: 'status',
        render: (role) => (
          <Badge variant={role.status === 'active' ? 'default' : 'secondary'}>
            {role.status === 'active' ? '启用' : '禁用'}
          </Badge>
        ),
      },
      {
        key: 'createdAt',
        render: (role) => (
          <span className="text-muted-foreground">
            {formatDateTimeDisplay(role.createdAt) || '-'}
          </span>
        ),
      },
    ],
  });

  const rowActions = useMemo(
    () =>
      createStandardActions<RoleProfile>({
        onView: crud.openViewDialog,
        onEdit: crud.openEditDialog,
        onDelete: crud.openDeleteDialog,
      }),
    [crud.openViewDialog, crud.openEditDialog, crud.openDeleteDialog]
  );

  const renderMobileCard = (role: RoleProfile) => (
    <GenericMobileCard
      title={role.name}
      status={<Badge variant="outline">{role.code}</Badge>}
      fields={[
        { label: '描述', value: role.description || '-' },
        { label: '用户数', value: role.userCount || 0 },
      ]}
      footer={formatDateTimeDisplay(role.createdAt) || '-'}
      onClick={() => crud.openViewDialog(role)}
      testId={`role-${role.id}`}
    />
  );

  return (
    <MobileBottomBarSpacer hasBottomBar={isMobile}>
      <StandardLayout
        toolbar={
          <StandardToolbar
            onCreate={crud.openCreateDialog}
            createLabel="新建角色"
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
            title: '暂无角色数据',
            description: '点击"新建角色"按钮添加您的第一个角色',
            icon: <Shield className="h-12 w-12 text-muted-foreground/50" />,
          }}
        />

        <FormDialog
          {...crud.formDialogProps}
          variant="drawer"
          title={crud.isEditing ? '角色详情' : '新建角色'}
          onSubmit={crud.handleSubmit}
        >
          <div className="col-span-1 space-y-6 py-4 md:col-span-2">
            <div className={cn('grid gap-4', !isMobile && 'grid-cols-2')}>
              <FormField
                name="code"
                label="角色编码"
                required
                error={crud.getFieldError('code')}
                viewContent={<Badge variant="outline">{crud.formData.code}</Badge>}
              >
                <Input
                  id="code"
                  data-testid="role-code-input"
                  placeholder="如: ADMIN, STORE_MANAGER"
                  value={crud.formData.code}
                  onChange={(e) => crud.updateFormField('code', e.target.value.toUpperCase())}
                  disabled={crud.isEditing}
                />
              </FormField>

              <FormField
                name="name"
                label="角色名称"
                required
                error={crud.getFieldError('name')}
                viewContent={crud.formData.name}
              >
                <Input
                  id="name"
                  data-testid="role-name-input"
                  placeholder="如: 管理员, 店长"
                  value={crud.formData.name}
                  onChange={(e) => crud.updateFormField('name', e.target.value)}
                />
              </FormField>
            </div>

            <FormField
              name="description"
              label="描述"
              error={crud.getFieldError('description')}
              viewContent={crud.formData.description}
            >
              <Textarea
                id="description"
                data-testid="role-description-input"
                placeholder="角色描述..."
                value={crud.formData.description}
                onChange={(e) => crud.updateFormField('description', e.target.value)}
              />
            </FormField>

            <FormField
              name="userIds"
              label="角色人员"
              fullRow
              error={crud.getFieldError('userIds')}
              viewContent={
                <div className="flex min-h-[40px] flex-wrap items-center gap-1 rounded-md bg-muted/50 px-3 py-2">
                  {(crud.formData.userIds ?? []).length > 0 ? (
                    (crud.formData.userIds ?? []).map((userId) => {
                      const user = users.find((item) => item.id === userId);
                      return user ? (
                        <Badge key={userId} variant="outline">
                          {user.name}
                        </Badge>
                      ) : null;
                    })
                  ) : (
                    <span className="text-sm text-muted-foreground">未分配人员</span>
                  )}
                </div>
              }
            >
              <MultiSelect
                data-testid="role-users-select"
                options={userOptions}
                value={crud.formData.userIds ?? []}
                onChange={(value) => crud.updateFormField('userIds', value)}
                placeholder="选择人员"
              />
            </FormField>

            <div className="space-y-4">
              <Label>权限配置</Label>
              {isMobile ? (
                <div className="space-y-3">
                  {permissionModules.map((module) => {
                    const allPermKeys = module.menus.flatMap((m) =>
                      m.permissions.map((a) => `${module.key}:${m.key}:${a}`)
                    );
                    const allChecked = allPermKeys.every((k) =>
                      crud.formData.permissions.includes(k)
                    );
                    const someChecked = allPermKeys.some((k) =>
                      crud.formData.permissions.includes(k)
                    );

                    return (
                      <div key={module.key} className="rounded-lg border p-3">
                        <div className="mb-2 flex items-center gap-2">
                          <Checkbox
                            checked={allChecked ? true : someChecked ? 'indeterminate' : false}
                            onCheckedChange={() =>
                              !crud.isViewMode &&
                              toggleAllModulePermissions(module.key, module.menus)
                            }
                            disabled={crud.isViewMode}
                            data-testid={`module-checkbox-${module.key}`}
                          />
                          <span className="font-medium">{module.name}</span>
                        </div>
                        <div className="ml-4 space-y-2">
                          {module.menus.map((menu) => (
                            <div key={menu.key} className="rounded border p-2">
                              <div className="mb-1 text-sm text-muted-foreground">{menu.name}</div>
                              <div className="flex flex-wrap gap-2">
                                {menu.permissions.map((perm) => {
                                  const permKey = `${module.key}:${menu.key}:${perm}`;
                                  return (
                                    <label key={perm} className="flex items-center gap-1 text-sm">
                                      <Checkbox
                                        checked={crud.formData.permissions.includes(permKey)}
                                        onCheckedChange={() =>
                                          !crud.isViewMode && togglePermission(permKey)
                                        }
                                        disabled={crud.isViewMode}
                                        data-testid={`permission-checkbox-${permKey}`}
                                      />
                                      <span>{permissionLabels[perm]}</span>
                                    </label>
                                  );
                                })}
                              </div>
                              {(() => {
                                const menuKey = `${module.key}:${menu.key}`;
                                const hasAnyAction = menu.permissions.some((a) =>
                                  crud.formData.permissions.includes(`${menuKey}:${a}`)
                                );
                                return (
                                  <div className="mt-2 flex items-center gap-2 text-xs">
                                    <span className="text-muted-foreground">数据范围:</span>
                                    <SelectRoot
                                      value={crud.formData.viewScopes?.[menuKey] ?? 'SELF'}
                                      onValueChange={(value) => {
                                        if (crud.isViewMode) return;
                                        crud.setFormData((prev) => ({
                                          ...prev,
                                          viewScopes: {
                                            ...(prev.viewScopes ?? {}),
                                            [menuKey]: value as 'SELF' | 'ALL',
                                          },
                                        }));
                                      }}
                                      disabled={crud.isViewMode || !hasAnyAction}
                                    >
                                      <SelectTrigger
                                        className="h-7 w-[100px] text-xs"
                                        title={
                                          !hasAnyAction ? '请先勾选至少一个操作权限' : undefined
                                        }
                                      >
                                        <SelectValue />
                                      </SelectTrigger>
                                      <SelectContent>
                                        <SelectItem value="SELF">仅本人</SelectItem>
                                        <SelectItem value="ALL">全部数据</SelectItem>
                                      </SelectContent>
                                    </SelectRoot>
                                  </div>
                                );
                              })()}
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="rounded-lg border">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-muted/50">
                        <TableHead className="w-[150px]">功能模块</TableHead>
                        {['view', 'create', 'edit', 'delete', 'export', 'approve'].map((perm) => (
                          <TableHead key={perm} className="w-[80px]">
                            {permissionLabels[perm as PermissionAction]}
                          </TableHead>
                        ))}
                        <TableHead className="w-[120px]">数据范围</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {permissionModules.map((module) => {
                        const allPermKeys = module.menus.flatMap((m) =>
                          m.permissions.map((a) => `${module.key}:${m.key}:${a}`)
                        );
                        const allModuleChecked = allPermKeys.every((k) =>
                          crud.formData.permissions.includes(k)
                        );
                        const someModuleChecked = allPermKeys.some((k) =>
                          crud.formData.permissions.includes(k)
                        );

                        return (
                          <React.Fragment key={module.key}>
                            {/* 模块行 - 带全选功能 */}
                            <TableRow className="bg-muted/30">
                              <TableCell>
                                <div className="flex items-center gap-2">
                                  <Checkbox
                                    checked={
                                      allModuleChecked
                                        ? true
                                        : someModuleChecked
                                          ? 'indeterminate'
                                          : false
                                    }
                                    onCheckedChange={() =>
                                      !crud.isViewMode &&
                                      toggleAllModulePermissions(module.key, module.menus)
                                    }
                                    disabled={crud.isViewMode}
                                    data-testid={`module-checkbox-${module.key}`}
                                  />
                                  <span className="font-medium">{module.name}</span>
                                </div>
                              </TableCell>
                              {['view', 'create', 'edit', 'delete', 'export', 'approve'].map(
                                (perm) => {
                                  const action = perm as PermissionAction;
                                  const eligibleMenus = module.menus;
                                  const hasPermission = eligibleMenus.some((menu) =>
                                    menu.permissions.includes(action)
                                  );
                                  if (!hasPermission) {
                                    return (
                                      <TableCell key={perm}>
                                        <span className="text-muted-foreground">-</span>
                                      </TableCell>
                                    );
                                  }

                                  const menuPermKeys = eligibleMenus
                                    .filter((m) => m.permissions.includes(action))
                                    .map((m) => `${module.key}:${m.key}:${action}`);
                                  const allActionChecked = menuPermKeys.every((k) =>
                                    crud.formData.permissions.includes(k)
                                  );
                                  const someActionChecked = menuPermKeys.some((k) =>
                                    crud.formData.permissions.includes(k)
                                  );

                                  return (
                                    <TableCell key={perm}>
                                      <Checkbox
                                        checked={
                                          allActionChecked
                                            ? true
                                            : someActionChecked
                                              ? 'indeterminate'
                                              : false
                                        }
                                        onCheckedChange={() =>
                                          !crud.isViewMode &&
                                          toggleModuleAction(module.key, module.menus, action)
                                        }
                                        disabled={crud.isViewMode}
                                      />
                                    </TableCell>
                                  );
                                }
                              )}
                              <TableCell>
                                <span className="text-muted-foreground">-</span>
                              </TableCell>
                            </TableRow>
                            {/* 菜单行 - 逐个菜单 */}
                            {module.menus.map((menu) => (
                              <TableRow key={`${module.key}:${menu.key}`} className={undefined}>
                                <TableCell>
                                  <span className="ml-8 text-sm text-muted-foreground">
                                    {menu.name}
                                  </span>
                                </TableCell>
                                {['view', 'create', 'edit', 'delete', 'export', 'approve'].map(
                                  (perm) => {
                                    const action = perm as PermissionAction;
                                    const hasPermission = menu.permissions.includes(action);
                                    if (!hasPermission) {
                                      return (
                                        <TableCell key={perm}>
                                          <span className="text-muted-foreground">-</span>
                                        </TableCell>
                                      );
                                    }

                                    const permKey = `${module.key}:${menu.key}:${action}`;
                                    return (
                                      <TableCell key={perm}>
                                        <Checkbox
                                          checked={crud.formData.permissions.includes(permKey)}
                                          onCheckedChange={() =>
                                            !crud.isViewMode && togglePermission(permKey)
                                          }
                                          disabled={crud.isViewMode}
                                          data-testid={`permission-checkbox-${permKey}`}
                                        />
                                      </TableCell>
                                    );
                                  }
                                )}
                                {(() => {
                                  const menuKey = `${module.key}:${menu.key}`;
                                  const hasAnyAction = menu.permissions.some((a) =>
                                    crud.formData.permissions.includes(`${menuKey}:${a}`)
                                  );
                                  return (
                                    <TableCell>
                                      <SelectRoot
                                        value={crud.formData.viewScopes?.[menuKey] ?? 'SELF'}
                                        onValueChange={(value) => {
                                          if (crud.isViewMode) return;
                                          crud.setFormData((prev) => ({
                                            ...prev,
                                            viewScopes: {
                                              ...(prev.viewScopes ?? {}),
                                              [menuKey]: value as 'SELF' | 'ALL',
                                            },
                                          }));
                                        }}
                                        disabled={crud.isViewMode || !hasAnyAction}
                                      >
                                        <SelectTrigger
                                          className="h-8 w-[100px]"
                                          title={
                                            !hasAnyAction ? '请先勾选至少一个操作权限' : undefined
                                          }
                                        >
                                          <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                          <SelectItem value="SELF">仅本人</SelectItem>
                                          <SelectItem value="ALL">全部数据</SelectItem>
                                        </SelectContent>
                                      </SelectRoot>
                                    </TableCell>
                                  );
                                })()}
                              </TableRow>
                            ))}
                          </React.Fragment>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              )}
            </div>
          </div>
        </FormDialog>

        <DeleteConfirm {...crud.deleteConfirmProps} />
        <BulkDeleteConfirm {...crud.bulkDeleteConfirmProps} />
      </StandardLayout>
      {isMobile && (
        <MobileBottomBar>
          <Button className="flex-1" onClick={crud.openCreateDialog}>
            <Plus className="mr-2 h-4 w-4" />
            新建角色
          </Button>
        </MobileBottomBar>
      )}
    </MobileBottomBarSpacer>
  );
}
