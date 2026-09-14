import {
  buildDateFilter,
  buildEnumFilter,
  buildStringFilter,
  defineFilterRegistry,
  type FilterOption,
} from '../../common/filter-scheme';

const ROLE_PAGE_KEY = 'system.roles';

// 角色 status 只支持 'active' / 'disabled'（见 queryRoleSchema）
const ROLE_STATUS_LABELS: Record<string, string> = {
  active: '启用',
  disabled: '禁用',
};
const ROLE_STATUS_SET = new Set<string>(Object.keys(ROLE_STATUS_LABELS));

function statusOptions(): FilterOption[] {
  return Object.entries(ROLE_STATUS_LABELS).map(([value, label]) => ({ value, label }));
}

export const ROLE_FILTER_REGISTRY = defineFilterRegistry({
  pageKey: ROLE_PAGE_KEY,
  pageName: '角色列表',
  fields: {
    status: {
      label: '状态',
      dataType: 'enum',
      allowedControls: ['select', 'multiSelect'],
      optionsSource: statusOptions,
      build: (value) => buildEnumFilter('status', ROLE_STATUS_SET, value),
    },
    createdAt: {
      label: '创建时间',
      dataType: 'date',
      allowedControls: ['date', 'dateRange'],
      build: (value) => buildDateFilter('createdAt', value),
    },
    updatedAt: {
      label: '最近修改',
      dataType: 'date',
      allowedControls: ['date', 'dateRange'],
      build: (value) => buildDateFilter('updatedAt', value),
    },
    code: {
      label: '角色编码',
      dataType: 'string',
      searchable: true,
      allowedControls: ['text'],
      build: (value) => buildStringFilter('code', value),
    },
    name: {
      label: '角色名称',
      dataType: 'string',
      searchable: true,
      allowedControls: ['text'],
      build: (value) => buildStringFilter('name', value),
    },
  },
  defaults: {
    fields: [{ fieldKey: 'status', control: 'select' }],
    keyword: {
      enabled: true,
      fieldKeys: ['code', 'name'],
      placeholder: '角色编码/名称',
    },
  },
});
