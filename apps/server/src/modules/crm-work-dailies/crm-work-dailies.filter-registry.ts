import {
  RECORD_STATUS_LABELS,
  WORK_DAILY_STATUS_LABELS,
} from '@ky-azeroth/shared/constants/status-labels';

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

const CRM_WORK_DAILY_PAGE_KEY = 'reports.work_dailies';

const WORK_DAILY_STATUS_SET = new Set<string>(Object.keys(WORK_DAILY_STATUS_LABELS));
const RECORD_STATUS_SET = new Set<string>(Object.keys(RECORD_STATUS_LABELS));

export const CRM_WORK_DAILY_FILTER_REGISTRY = defineFilterRegistry({
  pageKey: CRM_WORK_DAILY_PAGE_KEY,
  pageName: '工作日报列表',
  fields: {
    submitStatus: {
      label: '提交状态',
      dataType: 'enum',
      allowedControls: ['select', 'multiSelect'],
      optionsSource: () => toOptions(WORK_DAILY_STATUS_LABELS),
      build: (value) => buildEnumFilter('submitStatus', WORK_DAILY_STATUS_SET, value),
    },
    reportType: {
      label: '报告类型',
      dataType: 'enum',
      allowedControls: ['select', 'multiSelect'],
      // reportType 是业务自由枚举（日报/周报/月报），不限白名单
      build: (value) => buildStringListFilter('reportType', value),
    },
    status: {
      label: '记录状态',
      dataType: 'enum',
      allowedControls: ['select', 'multiSelect'],
      optionsSource: () => toOptions(RECORD_STATUS_LABELS),
      build: (value) => buildEnumFilter('status', RECORD_STATUS_SET, value),
    },
    senderId: {
      label: '提交人',
      dataType: 'foreignKey',
      entity: 'employee',
      // 注意：CrmWorkDaily 用 senderId 而非 chargerId 做数据范围字段。
      // 标记 isScopeField=true，FilterApplier 会自动把 chargerScope 注入到 senderId。
      isScopeField: true,
      allowedControls: ['entitySelect', 'entityMultiSelect'],
      build: (value) => buildForeignKeyFilter('senderId', value),
    },
    reportDate: {
      label: '日报日期',
      dataType: 'date',
      allowedControls: ['date', 'dateRange'],
      build: (value) => buildDateFilter('reportDate', value),
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
    callsMadeCount: {
      label: '拨打电话',
      dataType: 'int',
      allowedControls: ['numberEqual', 'numberRange'],
      build: (value) => buildNumberFilter('callsMadeCount', value),
    },
    callsConnectedCount: {
      label: '接通电话',
      dataType: 'int',
      allowedControls: ['numberEqual', 'numberRange'],
      build: (value) => buildNumberFilter('callsConnectedCount', value),
    },
    callsOver30sCount: {
      label: '三十秒',
      dataType: 'int',
      allowedControls: ['numberEqual', 'numberRange'],
      build: (value) => buildNumberFilter('callsOver30sCount', value),
    },
    totalCallMinutes: {
      label: '总时长(分)',
      dataType: 'int',
      allowedControls: ['numberEqual', 'numberRange'],
      build: (value) => buildNumberFilter('totalCallMinutes', value),
    },
    visitCustomerCount: {
      label: '拜访客户',
      dataType: 'int',
      allowedControls: ['numberEqual', 'numberRange'],
      build: (value) => buildNumberFilter('visitCustomerCount', value),
    },
    newCustomerCount: {
      label: '新增客户',
      dataType: 'int',
      allowedControls: ['numberEqual', 'numberRange'],
      build: (value) => buildNumberFilter('newCustomerCount', value),
    },
    newContactMethodCount: {
      label: '新增联系方式',
      dataType: 'int',
      allowedControls: ['numberEqual', 'numberRange'],
      build: (value) => buildNumberFilter('newContactMethodCount', value),
    },
    senderName: {
      label: '提交人姓名',
      dataType: 'string',
      searchable: true,
      allowedControls: ['text'],
      build: (value) =>
        buildStringFilterWithRelationFallback('senderName', 'sender', 'name', value),
    },
    keyCustomerSummary: {
      label: '重点客户总结',
      dataType: 'string',
      // 长文本字段不开放 searchable，避免全表扫（与 plan §6 keyword 性能守则一致）
      allowedControls: ['text'],
      build: (value) => buildStringFilter('keyCustomerSummary', value),
    },
  },
  defaults: {
    fields: [
      { fieldKey: 'reportType', control: 'multiSelect' },
      { fieldKey: 'submitStatus', control: 'multiSelect' },
      { fieldKey: 'reportDate', control: 'dateRange' },
      { fieldKey: 'senderId', control: 'entitySelect' },
    ],
    keyword: {
      enabled: true,
      fieldKeys: ['senderName'],
      placeholder: '提交人',
    },
  },
});
