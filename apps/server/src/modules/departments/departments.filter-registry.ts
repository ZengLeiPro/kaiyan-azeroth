import { DEPARTMENT_STATUS_LABELS } from '@ky-azeroth/shared/constants/status-labels';

import {
  buildDateFilter,
  buildEnumFilter,
  buildForeignKeyFilter,
  buildStringFilter,
  defineFilterRegistry,
  toOptions,
} from '../../common/filter-scheme';

const DEPARTMENT_PAGE_KEY = 'organization.departments';

const DEPARTMENT_STATUS_SET = new Set<string>(Object.keys(DEPARTMENT_STATUS_LABELS));

export const DEPARTMENT_FILTER_REGISTRY = defineFilterRegistry({
  pageKey: DEPARTMENT_PAGE_KEY,
  pageName: '部门列表',
  fields: {
    status: {
      label: '状态',
      dataType: 'enum',
      allowedControls: ['select', 'multiSelect'],
      optionsSource: () => toOptions(DEPARTMENT_STATUS_LABELS),
      build: (value) => buildEnumFilter('status', DEPARTMENT_STATUS_SET, value),
    },
    parentId: {
      label: '上级部门',
      dataType: 'foreignKey',
      entity: 'department',
      allowedControls: ['entitySelect', 'entityMultiSelect'],
      build: (value) => buildForeignKeyFilter('parentId', value),
    },
    managerId: {
      label: '负责人',
      dataType: 'foreignKey',
      entity: 'employee',
      allowedControls: ['entitySelect', 'entityMultiSelect'],
      build: (value) => buildForeignKeyFilter('managerId', value),
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
    name: {
      label: '部门名称',
      dataType: 'string',
      searchable: true,
      allowedControls: ['text'],
      build: (value) => buildStringFilter('name', value),
    },
  },
  defaults: {
    fields: [{ fieldKey: 'status', control: 'multiSelect' }],
    keyword: {
      enabled: true,
      fieldKeys: ['name'],
      placeholder: '部门名称',
    },
  },
});
