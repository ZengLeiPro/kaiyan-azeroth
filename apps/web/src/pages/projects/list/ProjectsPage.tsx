// 触发内置渲染器/导出格式化器注册（副作用 import）
import '@/lib/column-renderers';
import '@/lib/column-export-formatters';

import {
  PROJECT_CATEGORY_LABELS,
  PROJECT_STATUS_LABELS,
} from '@ky-azeroth/shared/constants/status-labels';
import { PROJECT_STATUS } from '@ky-azeroth/shared/constants/status-values';
import { projectResponseSchema } from '@ky-azeroth/shared/schemas/project';
import type { IProjectResponse } from '@ky-azeroth/shared/types/project';
import { FolderKanban, Plus } from 'lucide-react';
import { useMemo } from 'react';

import { MobileBottomBar, MobileBottomBarSpacer } from '@/components/mobile';
import { BulkDeleteConfirm } from '@/components/patterns/bulk-delete-confirm';
import { ColumnVisibilityDropdown } from '@/components/patterns/column-visibility';
import { CrudFilterBar } from '@/components/patterns/crud-filter-bar';
import { CrudTable } from '@/components/patterns/crud-table';
import { CustomerSelect } from '@/components/patterns/customer-select';
import { DeleteConfirm } from '@/components/patterns/delete-confirm';
import { EmployeeSelect } from '@/components/patterns/employee-select';
import { FilterBarSkeleton } from '@/components/patterns/filter-bar-skeleton';
import { FormDialog } from '@/components/patterns/form-dialog';
import { FormField } from '@/components/patterns/form-field';
import { GenericMobileCard } from '@/components/patterns/generic-mobile-card';
import { OpportunitySelect } from '@/components/patterns/opportunity-select';
import { RelatedEntityLink } from '@/components/patterns/related-entity-link';
import { createStandardActions } from '@/components/patterns/row-actions-helpers';
import { SaleOrderSelect } from '@/components/patterns/sale-order-select';
import { StandardToolbar } from '@/components/patterns/standard-toolbar';
import { StatusBadge } from '@/components/patterns/status-badge';
import { StandardLayout } from '@/components/templates/standard-layout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  SelectContent,
  SelectItem,
  SelectRoot,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useColumnVisibility } from '@/hooks/use-column-visibility';
import { useCrud } from '@/hooks/use-crud';
import { useFilterScheme } from '@/hooks/use-filter-scheme';
import { useManualFilter } from '@/hooks/use-manual-filter';
import { useIsMobile } from '@/hooks/use-mobile';
import { deriveColumnsFromSchema } from '@/lib/columns-from-schema';
import { projectCategoryMap, projectStatusMap } from '@/lib/status-maps';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/stores/auth';

import { ProjectDrawerBody } from './components/ProjectDrawerBody';
import { ProjectMemberSection } from './components/ProjectMemberSection';
import {
  type ProjectFormData,
  projectFormSchema,
  type ProjectProfile,
  toProjectFormData,
  toProjectPayload,
  toProjectProfile,
} from './types';

/**
 * 项目列表列配置。
 *
 * 列定义仍由 `projectResponseSchema` 派生；这里仅维护默认显隐、菜单标签与用户可拖拽顺序。
 */
const PROJECT_COLUMN_CONFIG = [
  { key: 'name', label: '项目名称', visible: true, canHide: false },
  { key: 'status', label: '状态', visible: true },
  { key: 'category', label: '分类', visible: true },
  { key: 'ownerName', label: '负责人', visible: true },
  { key: 'customerName', label: '客户', visible: true },
  { key: 'description', label: '描述', visible: true },
  { key: 'totalHours', label: '总工时', visible: true },
  { key: 'createdAt', label: '创建时间', visible: true },
  { key: 'updatedAt', label: '最近修改', visible: true },
];

export function ProjectsPage() {
  const isMobile = useIsMobile();
  const { hasMenuPermission, user } = useAuthStore();
  const canCreate = hasMenuPermission('projects', 'project_list', 'create');
  const canEdit = hasMenuPermission('projects', 'project_list', 'edit');
  const canDelete = hasMenuPermission('projects', 'project_list', 'delete');

  // 当前登录用户的 employeeId 作为「负责人」字段在新增时的默认值。
  const currentEmployeeId = user?.employee?.id ?? user?.id ?? null;

  // 筛选字段 + 初始 state 全由服务端的 filter-scheme registry/config 驱动。
  const scheme = useFilterScheme('projects.list');
  const filter = useManualFilter(scheme.initialFilters, undefined, scheme.version);

  const initialFormData = useMemo<ProjectFormData>(
    () => ({
      name: '',
      description: null,
      status: PROJECT_STATUS.NOT_STARTED,
      category: null,
      customerId: null,
      opportunityId: null,
      saleOrderId: null,
      ownerId: currentEmployeeId,
    }),
    [currentEmployeeId]
  );

  const crud = useCrud<ProjectProfile, ProjectFormData, IProjectResponse>({
    endpoint: '/projects',
    requireVersion: true,
    schema: projectFormSchema,
    validateMode: 'onSubmit',
    initialFormData,
    entityToForm: toProjectFormData,
    formToPayload: (form) => toProjectPayload(form),
    getEntityName: (project) => project.name,
    transformData: (data) => data.map(toProjectProfile),
    paginationOptions: {
      initialSortBy: 'createdAt',
      initialSortOrder: 'desc',
      extraParams: filter.apiParams,
    },
  });

  const columnVisibility = useColumnVisibility(PROJECT_COLUMN_CONFIG, {
    onServerSortingApplied: crud.sorting.applyServerSorting,
  });

  // 表格列：从 `projectResponseSchema` 派生 header/width/sortable；status/category 已走
  // schema statusBadge 自动渲染。muted 文本 + 截断/日期本地化格式化保留在 overrides 中。
  const columns = useMemo(
    () =>
      deriveColumnsFromSchema<ProjectProfile>(projectResponseSchema, {
        overrides: [
          {
            key: 'name',
            render: (project) => <span className="font-medium">{project.name}</span>,
          },
          {
            key: 'ownerName',
            render: (project) => (
              <span className="text-muted-foreground">{project.ownerName || '-'}</span>
            ),
          },
          {
            key: 'customerName',
            render: (project) => (
              <RelatedEntityLink
                entityType="customer"
                id={project.customerId}
                label={project.customerName}
                title={project.customerName ?? undefined}
              />
            ),
          },
          {
            key: 'description',
            render: (project) => (
              <span className="text-muted-foreground" title={project.description ?? undefined}>
                {project.description
                  ? project.description.length > 30
                    ? `${project.description.slice(0, 30)}...`
                    : project.description
                  : '-'}
              </span>
            ),
          },
        ],
      }),
    []
  );

  const rowActions = useMemo(
    () =>
      createStandardActions<ProjectProfile>({
        onView: crud.openViewDialog,
        onEdit: crud.openEditDialog,
        onDelete: crud.openDeleteDialog,
        hideEdit: !canEdit,
        hideDelete: !canDelete,
      }),
    [crud.openViewDialog, crud.openEditDialog, crud.openDeleteDialog, canEdit, canDelete]
  );

  const renderMobileCard = (project: ProjectProfile) => (
    <GenericMobileCard
      title={project.name}
      status={<StatusBadge status={project.status} statusMap={projectStatusMap} />}
      fields={[
        { label: '负责人', value: project.ownerName || '-' },
        {
          label: '描述',
          value: project.description
            ? project.description.length > 20
              ? `${project.description.slice(0, 20)}...`
              : project.description
            : '-',
        },
      ]}
      onClick={() => crud.openViewDialog(project)}
      testId={`project-${project.id}`}
    />
  );

  return (
    <MobileBottomBarSpacer hasBottomBar={isMobile}>
      <StandardLayout
        toolbar={
          <StandardToolbar
            onCreate={canCreate ? crud.openCreateDialog : undefined}
            createLabel="新建项目"
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
            filters={
              scheme.isLoading ? (
                <FilterBarSkeleton count={4} />
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
            title: '暂无项目数据',
            description: '点击"新建项目"按钮添加第一个项目',
            icon: <FolderKanban className="h-12 w-12 text-muted-foreground/50" />,
          }}
        />

        <FormDialog
          {...crud.formDialogProps}
          variant="drawer"
          title={crud.isEditing ? '项目详情' : '新建项目'}
          onSubmit={crud.handleSubmit}
        >
          {(() => {
            const projectFields = (
              <div className="col-span-1 space-y-6 py-4 md:col-span-2">
                <div className={cn('grid gap-4', !isMobile && 'grid-cols-2')}>
                  {/* 项目名称 */}
                  <FormField
                    name="name"
                    label="项目名称"
                    required
                    error={crud.getFieldError('name')}
                    viewContent={crud.formData.name}
                  >
                    <Input
                      id="name"
                      placeholder="请输入项目名称"
                      value={crud.formData.name}
                      onChange={(e) => crud.updateFormField('name', e.target.value)}
                    />
                  </FormField>

                  {/* 客户（必填，挪到第一行右侧） */}
                  <FormField
                    name="customerId"
                    label="客户"
                    required
                    error={crud.getFieldError('customerId')}
                    viewContent={crud.editingEntity?.customerName}
                  >
                    <CustomerSelect
                      value={crud.formData.customerId ?? ''}
                      onChange={(v) => crud.updateFormField('customerId', v || null)}
                      placeholder="搜索并选择客户"
                    />
                  </FormField>

                  {/* 关联商机（项目与商机一对一，可选） */}
                  <FormField
                    name="opportunityId"
                    label="关联商机"
                    error={crud.getFieldError('opportunityId')}
                    viewContent={crud.editingEntity?.opportunityName}
                  >
                    <OpportunitySelect
                      value={crud.formData.opportunityId ?? ''}
                      customerId={crud.formData.customerId ?? undefined}
                      onChange={(value) => {
                        crud.updateFormField('opportunityId', value || null);
                        if (!value) crud.updateFormField('saleOrderId', null);
                      }}
                      onSelectedOpportunityChange={(opportunity) => {
                        if (
                          opportunity?.customerId &&
                          opportunity.customerId !== crud.formData.customerId
                        ) {
                          crud.updateFormField('customerId', opportunity.customerId);
                        }
                      }}
                      placeholder="搜索并选择商机"
                    />
                  </FormField>

                  {/* 合同订单（限定为所选商机下的唯一订单，可选） */}
                  <FormField
                    name="saleOrderId"
                    label="合同订单"
                    error={crud.getFieldError('saleOrderId')}
                    viewContent={crud.editingEntity?.orderTitle}
                  >
                    <SaleOrderSelect
                      value={crud.formData.saleOrderId ?? ''}
                      customerId={crud.formData.customerId ?? undefined}
                      opportunityId={crud.formData.opportunityId ?? undefined}
                      onChange={(value) => crud.updateFormField('saleOrderId', value || null)}
                      disabled={!crud.formData.opportunityId}
                      placeholder={
                        crud.formData.opportunityId ? '搜索并选择合同订单' : '请先选择商机'
                      }
                    />
                  </FormField>

                  {/* 状态 */}
                  <FormField
                    name="status"
                    label="状态"
                    required
                    error={crud.getFieldError('status')}
                    viewContent={
                      <StatusBadge
                        status={crud.formData.status ?? PROJECT_STATUS.NOT_STARTED}
                        statusMap={projectStatusMap}
                      />
                    }
                  >
                    <SelectRoot
                      value={crud.formData.status ?? PROJECT_STATUS.NOT_STARTED}
                      onValueChange={(val) => crud.updateFormField('status', val)}
                    >
                      <SelectTrigger id="status">
                        <SelectValue placeholder="请选择状态" />
                      </SelectTrigger>
                      <SelectContent>
                        {Object.entries(PROJECT_STATUS_LABELS).map(([value, label]) => (
                          <SelectItem key={value} value={value}>
                            {label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </SelectRoot>
                  </FormField>

                  {/* 分类 */}
                  <FormField
                    name="category"
                    label="分类"
                    required
                    error={crud.getFieldError('category')}
                    viewContent={
                      crud.formData.category ? (
                        <StatusBadge
                          status={crud.formData.category}
                          statusMap={projectCategoryMap}
                        />
                      ) : undefined
                    }
                  >
                    <SelectRoot
                      value={crud.formData.category ?? ''}
                      onValueChange={(val) => crud.updateFormField('category', val)}
                    >
                      <SelectTrigger id="category">
                        <SelectValue placeholder="请选择分类" />
                      </SelectTrigger>
                      <SelectContent>
                        {Object.entries(PROJECT_CATEGORY_LABELS).map(([value, label]) => (
                          <SelectItem key={value} value={value}>
                            {label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </SelectRoot>
                  </FormField>

                  {/* 负责人 */}
                  <FormField
                    name="ownerId"
                    label="负责人"
                    required
                    error={crud.getFieldError('ownerId')}
                    viewContent={crud.editingEntity?.ownerName}
                  >
                    <EmployeeSelect
                      value={crud.formData.ownerId ?? ''}
                      onChange={(v) => crud.updateFormField('ownerId', v || null)}
                      placeholder="搜索并选择负责人"
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
                    placeholder="请输入项目描述"
                    rows={3}
                    value={crud.formData.description ?? ''}
                    onChange={(e) => crud.updateFormField('description', e.target.value || null)}
                  />
                </FormField>
              </div>
            );

            const memberSection = crud.editingEntity ? (
              <ProjectMemberSection
                projectId={crud.editingEntity.id}
                isViewMode={crud.isViewMode}
              />
            ) : null;

            if (crud.isViewMode && crud.editingEntity) {
              return (
                <ProjectDrawerBody
                  projectId={crud.editingEntity.id}
                  fieldsContent={projectFields}
                  memberSection={memberSection}
                />
              );
            }

            return (
              <>
                {projectFields}
                {memberSection && (
                  <div className="col-span-1 border-t px-1 pt-4 md:col-span-2">{memberSection}</div>
                )}
              </>
            );
          })()}
        </FormDialog>

        <DeleteConfirm {...crud.deleteConfirmProps} />
        <BulkDeleteConfirm {...crud.bulkDeleteConfirmProps} />
      </StandardLayout>
      {isMobile && canCreate && (
        <MobileBottomBar>
          <Button className="flex-1" onClick={crud.openCreateDialog}>
            <Plus className="mr-2 h-4 w-4" />
            新建项目
          </Button>
        </MobileBottomBar>
      )}
    </MobileBottomBarSpacer>
  );
}
