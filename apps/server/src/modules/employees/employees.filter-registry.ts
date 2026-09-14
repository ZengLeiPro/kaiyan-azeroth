import {
  EMPLOYEE_STATUS_LABELS,
  GENDER_LABELS,
  USER_STATUS_LABELS,
} from '@ky-azeroth/shared/constants/status-labels';

import {
  buildBooleanFilter,
  buildDateFilter,
  buildEnumFilter,
  buildStringFilter,
  defineFilterRegistry,
  toOptions,
} from '../../common/filter-scheme';

const EMPLOYEE_PAGE_KEY = 'organization.employees';

const EMPLOYEE_STATUS_SET = new Set<string>(Object.keys(EMPLOYEE_STATUS_LABELS));
const GENDER_SET = new Set<string>(Object.keys(GENDER_LABELS));
const USER_STATUS_SET = new Set<string>(Object.keys(USER_STATUS_LABELS));
const BOOLEAN_LABELS: Record<string, string> = {
  true: '是',
  false: '否',
};

export const EMPLOYEE_FILTER_REGISTRY = defineFilterRegistry({
  pageKey: EMPLOYEE_PAGE_KEY,
  pageName: '员工列表',
  fields: {
    status: {
      label: '状态',
      dataType: 'enum',
      allowedControls: ['select', 'multiSelect'],
      optionsSource: () => toOptions(EMPLOYEE_STATUS_LABELS),
      build: (value) => buildEnumFilter('status', EMPLOYEE_STATUS_SET, value),
    },
    loginStatus: {
      label: '登录状态',
      dataType: 'enum',
      allowedControls: ['select', 'multiSelect'],
      optionsSource: () => toOptions(USER_STATUS_LABELS),
      build: (value) => buildEnumFilter('loginStatus', USER_STATUS_SET, value),
    },
    canLogin: {
      label: '可登录',
      dataType: 'boolean',
      allowedControls: ['select'],
      optionsSource: () => toOptions(BOOLEAN_LABELS),
      build: (value) => buildBooleanFilter('canLogin', value),
    },
    gender: {
      label: '性别',
      dataType: 'enum',
      allowedControls: ['select', 'multiSelect'],
      optionsSource: () => toOptions(GENDER_LABELS),
      build: (value) => buildEnumFilter('gender', GENDER_SET, value),
    },
    isAdmin: {
      label: '是否管理员',
      dataType: 'boolean',
      allowedControls: ['select'],
      optionsSource: () => toOptions(BOOLEAN_LABELS),
      build: (value) => buildBooleanFilter('isAdmin', value),
    },
    isLeader: {
      label: '是否团队负责人',
      dataType: 'boolean',
      allowedControls: ['select'],
      optionsSource: () => toOptions(BOOLEAN_LABELS),
      build: (value) => buildBooleanFilter('isLeader', value),
    },
    dingtalkActive: {
      label: '钉钉激活',
      dataType: 'boolean',
      allowedControls: ['select'],
      optionsSource: () => toOptions(BOOLEAN_LABELS),
      build: (value) => buildBooleanFilter('dingtalkActive', value),
    },
    entryDate: {
      label: '入职日期',
      dataType: 'date',
      allowedControls: ['date', 'dateRange'],
      build: (value) => buildDateFilter('entryDate', value),
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
      label: '姓名',
      dataType: 'string',
      searchable: true,
      allowedControls: ['text'],
      build: (value) => buildStringFilter('name', value),
    },
    serialNumber: {
      label: '工号',
      dataType: 'string',
      searchable: true,
      allowedControls: ['text'],
      build: (value) => buildStringFilter('serialNumber', value),
    },
    phone: {
      label: '手机号',
      dataType: 'string',
      searchable: true,
      allowedControls: ['text'],
      build: (value) => buildStringFilter('phone', value),
    },
    position: {
      label: '职位',
      dataType: 'string',
      searchable: true,
      allowedControls: ['text'],
      build: (value) => buildStringFilter('position', value),
    },
    jobNumber: {
      label: '钉钉工号',
      dataType: 'string',
      searchable: true,
      allowedControls: ['text'],
      build: (value) => buildStringFilter('jobNumber', value),
    },
  },
  defaults: {
    fields: [{ fieldKey: 'status', control: 'multiSelect' }],
    keyword: {
      enabled: true,
      fieldKeys: ['name', 'serialNumber', 'phone'],
      placeholder: '姓名/工号/手机号',
    },
  },
});
