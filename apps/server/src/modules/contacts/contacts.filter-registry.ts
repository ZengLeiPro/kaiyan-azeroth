import { RECORD_STATUS_LABELS } from '@ky-azeroth/shared/constants/status-labels';

import {
  buildBooleanFilter,
  buildDateFilter,
  buildEnumFilter,
  buildForeignKeyFilter,
  buildStringFilter,
  defineFilterRegistry,
  toOptions,
} from '../../common/filter-scheme';

const CONTACT_PAGE_KEY = 'crm.contacts';

const RECORD_STATUS_SET = new Set<string>(Object.keys(RECORD_STATUS_LABELS));

export const CONTACT_FILTER_REGISTRY = defineFilterRegistry({
  pageKey: CONTACT_PAGE_KEY,
  pageName: '联系人列表',
  fields: {
    status: {
      label: '状态',
      dataType: 'enum',
      allowedControls: ['select', 'multiSelect'],
      optionsSource: () => toOptions(RECORD_STATUS_LABELS),
      build: (value) => buildEnumFilter('status', RECORD_STATUS_SET, value),
    },
    customerId: {
      label: '所属客户',
      dataType: 'foreignKey',
      entity: 'customer',
      allowedControls: ['entitySelect', 'entityMultiSelect'],
      build: (value) => buildForeignKeyFilter('customerId', value),
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
    contactName: {
      label: '联系人姓名',
      dataType: 'string',
      searchable: true,
      allowedControls: ['text'],
      build: (value) => buildStringFilter('contactName', value),
    },
    mobile: {
      label: '手机号',
      dataType: 'string',
      searchable: true,
      allowedControls: ['text'],
      build: (value) => buildStringFilter('mobile', value),
    },
    phone: {
      label: '电话',
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
    position: {
      label: '职位',
      dataType: 'string',
      searchable: true,
      allowedControls: ['text'],
      build: (value) => buildStringFilter('position', value),
    },
    // KP 筛选（2026-06-20 引入）：在销售/客户成功视角下快速锁定决策人
    isKp: {
      label: 'KP',
      dataType: 'boolean',
      allowedControls: ['select'],
      build: (value) => buildBooleanFilter('isKp', value),
    },
    kpRole: {
      label: '决策角色',
      dataType: 'string',
      allowedControls: ['text'],
      build: (value) => buildStringFilter('kpRole', value),
    },
  },
  defaults: {
    fields: [
      { fieldKey: 'status', control: 'multiSelect' },
      { fieldKey: 'customerId', control: 'entityMultiSelect' },
      { fieldKey: 'isKp', control: 'select' },
    ],
    keyword: {
      enabled: true,
      fieldKeys: ['contactName', 'mobile', 'phone'],
      placeholder: '姓名/手机号/电话',
    },
  },
});
