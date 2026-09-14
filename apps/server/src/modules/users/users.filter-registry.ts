import {
  buildEnumFilter,
  buildStringFilter,
  defineFilterRegistry,
  type FilterFieldBuildValue,
} from '../../common/filter-scheme';

const USER_STATUS = new Set(['active', 'disabled']);

function buildRoleFilter(value: FilterFieldBuildValue): Record<string, unknown> | null {
  const values = typeof value === 'string' ? [value] : Array.isArray(value) ? value : [];
  const roleIds = values.filter(
    (item): item is string => typeof item === 'string' && item.length > 0
  );
  return roleIds.length > 0 ? { userRoles: { some: { roleId: { in: roleIds } } } } : null;
}

export const USER_FILTER_REGISTRY = defineFilterRegistry({
  pageKey: 'system.users',
  pageName: '用户管理',
  fields: {
    status: {
      label: '状态',
      dataType: 'enum',
      allowedControls: ['multiSelect', 'select'],
      optionsSource: () => [
        { value: 'active', label: '启用' },
        { value: 'disabled', label: '禁用' },
      ],
      build: (value) => buildEnumFilter('loginStatus', USER_STATUS, value),
    },
    roleId: {
      label: '角色',
      dataType: 'foreignKey',
      entity: 'role',
      allowedControls: ['entityMultiSelect', 'entitySelect'],
      build: buildRoleFilter,
    },
    username: {
      label: '用户名',
      dataType: 'string',
      searchable: true,
      allowedControls: ['text'],
      build: (value) => buildStringFilter('username', value),
    },
    phone: {
      label: '手机号',
      dataType: 'string',
      searchable: true,
      allowedControls: ['text'],
      build: (value) => buildStringFilter('phone', value),
    },
    email: {
      label: '邮箱',
      dataType: 'string',
      searchable: true,
      allowedControls: ['text'],
      build: (value) => buildStringFilter('email', value),
    },
  },
  defaults: {
    fields: [
      { fieldKey: 'status', control: 'multiSelect' },
      { fieldKey: 'roleId', control: 'entityMultiSelect' },
    ],
    keyword: {
      enabled: true,
      fieldKeys: ['username', 'phone', 'email'],
      placeholder: '用户名/手机号/邮箱',
    },
  },
});
