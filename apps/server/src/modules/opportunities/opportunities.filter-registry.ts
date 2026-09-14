import {
  OPPORTUNITY_STAGE_LABELS,
  RECORD_STATUS_LABELS,
} from '@ky-azeroth/shared/constants/status-labels';

import {
  buildDateFilter,
  buildEnumFilter,
  buildForeignKeyFilter,
  buildNumberFilter,
  buildStringFilter,
  buildStringFilterWithRelationFallback,
  defineFilterRegistry,
  toOptions,
} from '../../common/filter-scheme';

const OPPORTUNITY_PAGE_KEY = 'crm.opportunities';

const OPPORTUNITY_STAGE_SET = new Set<string>(Object.keys(OPPORTUNITY_STAGE_LABELS));
const RECORD_STATUS_SET = new Set<string>(Object.keys(RECORD_STATUS_LABELS));

export const OPPORTUNITY_FILTER_REGISTRY = defineFilterRegistry({
  pageKey: OPPORTUNITY_PAGE_KEY,
  pageName: '商机列表',
  fields: {
    opportunityStage: {
      label: '阶段',
      dataType: 'enum',
      allowedControls: ['select', 'multiSelect'],
      optionsSource: () => toOptions(OPPORTUNITY_STAGE_LABELS),
      build: (value) => buildEnumFilter('opportunityStage', OPPORTUNITY_STAGE_SET, value),
    },
    status: {
      label: '记录状态',
      dataType: 'enum',
      allowedControls: ['select', 'multiSelect'],
      optionsSource: () => toOptions(RECORD_STATUS_LABELS),
      build: (value) => buildEnumFilter('status', RECORD_STATUS_SET, value),
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
      // 注意：opportunity 自身有 chargerId 字段，但数据范围过滤走双路径 OR
      // (chargerId IN scope OR customer.chargerId IN scope)。service 层在
      // baseWhere 里手拼 OR，并传 chargerScope:null 给 applier 阻止默认注入。
      allowedControls: ['entitySelect', 'entityMultiSelect'],
      build: (value) => buildForeignKeyFilter('chargerId', value),
    },
    expectedDealDate: {
      label: '预计成交日期',
      dataType: 'date',
      allowedControls: ['date', 'dateRange'],
      build: (value) => buildDateFilter('expectedDealDate', value),
    },
    realDealDate: {
      label: '实际成交日期',
      dataType: 'date',
      allowedControls: ['date', 'dateRange'],
      build: (value) => buildDateFilter('realDealDate', value),
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
    opportunityAmount: {
      label: '商机金额',
      dataType: 'decimal',
      allowedControls: ['numberEqual', 'numberRange'],
      build: (value) => buildNumberFilter('opportunityAmount', value),
    },
    winRate: {
      label: '赢单率',
      dataType: 'decimal',
      allowedControls: ['numberEqual', 'numberRange'],
      build: (value) => buildNumberFilter('winRate', value),
    },
    serialNumber: {
      label: '编号',
      dataType: 'string',
      searchable: true,
      allowedControls: ['text'],
      build: (value) => buildStringFilter('serialNumber', value),
    },
    opportunityName: {
      label: '商机名称',
      dataType: 'string',
      searchable: true,
      allowedControls: ['text'],
      build: (value) => buildStringFilter('opportunityName', value),
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
      { fieldKey: 'opportunityStage', control: 'multiSelect' },
      { fieldKey: 'customerId', control: 'entityMultiSelect' },
      { fieldKey: 'expectedDealDate', control: 'dateRange' },
    ],
    keyword: {
      enabled: true,
      fieldKeys: ['serialNumber', 'opportunityName', 'chargerName'],
      placeholder: '编号/商机名称/负责人',
    },
  },
});
