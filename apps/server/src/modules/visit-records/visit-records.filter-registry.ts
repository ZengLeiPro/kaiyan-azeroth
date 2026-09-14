import { VISIT_STATUS_LABELS } from '@ky-azeroth/shared/constants/status-labels';

import {
  buildDateFilter,
  buildEnumFilter,
  buildForeignKeyFilter,
  buildNumberFilter,
  buildStringFilter,
  buildStringFilterWithRelationFallback,
  buildStringListFilter,
  defineFilterRegistry,
  toOptions,
} from '../../common/filter-scheme';

const VISIT_RECORD_PAGE_KEY = 'crm.visit_records';

const VISIT_STATUS_SET = new Set<string>(Object.keys(VISIT_STATUS_LABELS));

export const VISIT_RECORD_FILTER_REGISTRY = defineFilterRegistry({
  pageKey: VISIT_RECORD_PAGE_KEY,
  pageName: '拜访签到列表',
  fields: {
    visitStatus: {
      label: '拜访状态',
      dataType: 'enum',
      allowedControls: ['select', 'multiSelect'],
      optionsSource: () => toOptions(VISIT_STATUS_LABELS),
      build: (value) => buildEnumFilter('visitStatus', VISIT_STATUS_SET, value),
    },
    visitType: {
      label: '拜访类型',
      dataType: 'enum',
      allowedControls: ['select', 'multiSelect'],
      // visitType 是业务自由枚举（如 "陌拜/签约/回访"），不限制白名单
      build: (value) => buildStringListFilter('visitType', value),
    },
    customerId: {
      label: '客户',
      dataType: 'foreignKey',
      entity: 'customer',
      allowedControls: ['entitySelect', 'entityMultiSelect'],
      build: (value) => buildForeignKeyFilter('customerId', value),
    },
    contactId: {
      label: '联系人',
      dataType: 'foreignKey',
      entity: 'contact',
      allowedControls: ['entitySelect', 'entityMultiSelect'],
      build: (value) => buildForeignKeyFilter('contactId', value),
    },
    chargerId: {
      label: '负责人',
      dataType: 'foreignKey',
      entity: 'employee',
      // 注意：visit_record 自身有 chargerId 字段，但数据范围过滤走双路径 OR
      // (chargerId IN scope OR customer.chargerId IN scope)。service 层在
      // baseWhere 里手拼 OR，并传 chargerScope:null 给 applier 阻止默认注入。
      allowedControls: ['entitySelect', 'entityMultiSelect'],
      build: (value) => buildForeignKeyFilter('chargerId', value),
    },
    signInTime: {
      label: '签到时间',
      dataType: 'date',
      allowedControls: ['date', 'dateRange'],
      build: (value) => buildDateFilter('signInTime', value),
    },
    signOutTime: {
      label: '签退时间',
      dataType: 'date',
      allowedControls: ['date', 'dateRange'],
      build: (value) => buildDateFilter('signOutTime', value),
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
    duration: {
      label: '时长(分钟)',
      dataType: 'int',
      allowedControls: ['numberEqual', 'numberRange'],
      build: (value) => buildNumberFilter('duration', value),
    },
    signAddress: {
      label: '签到地址',
      dataType: 'string',
      searchable: true,
      allowedControls: ['text'],
      build: (value) => buildStringFilter('signAddress', value),
    },
    chargerName: {
      label: '负责人姓名',
      dataType: 'string',
      searchable: true,
      allowedControls: ['text'],
      build: (value) =>
        buildStringFilterWithRelationFallback('chargerName', 'charger', 'name', value),
    },
  },
  defaults: {
    fields: [
      { fieldKey: 'visitType', control: 'multiSelect' },
      { fieldKey: 'customerId', control: 'entityMultiSelect' },
      { fieldKey: 'signInTime', control: 'dateRange' },
    ],
    keyword: {
      enabled: true,
      fieldKeys: ['signAddress', 'chargerName'],
      placeholder: '签到地址/负责人',
    },
  },
});
