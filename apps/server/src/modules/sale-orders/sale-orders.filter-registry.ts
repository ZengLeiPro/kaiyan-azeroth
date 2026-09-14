import {
  ORDER_STATUS_LABELS,
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

const SALE_ORDER_PAGE_KEY = 'crm.sale_orders';

const ORDER_STATUS_SET = new Set<string>(Object.keys(ORDER_STATUS_LABELS));
const RECORD_STATUS_SET = new Set<string>(Object.keys(RECORD_STATUS_LABELS));

export const SALE_ORDER_FILTER_REGISTRY = defineFilterRegistry({
  pageKey: SALE_ORDER_PAGE_KEY,
  pageName: '合同订单列表',
  fields: {
    orderStatus: {
      label: '订单状态',
      dataType: 'enum',
      allowedControls: ['select', 'multiSelect'],
      optionsSource: () => toOptions(ORDER_STATUS_LABELS),
      build: (value) => buildEnumFilter('orderStatus', ORDER_STATUS_SET, value),
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
    opportunityId: {
      label: '关联商机',
      dataType: 'foreignKey',
      entity: 'opportunity',
      allowedControls: ['entitySelect', 'entityMultiSelect'],
      build: (value) => buildForeignKeyFilter('opportunityId', value),
    },
    chargerId: {
      label: '负责人',
      dataType: 'foreignKey',
      entity: 'employee',
      // 注意：sale_order 自身有 chargerId 字段，但数据范围过滤走双路径 OR
      // (chargerId IN scope OR customer.chargerId IN scope)。service 层在
      // baseWhere 里手拼 OR，并传 chargerScope:null 给 applier 阻止默认注入。
      // 因此这里不标记 isScopeField，让 applier 把用户前端选的 chargerId
      // 当作普通 filter 处理（与 OR 取交集）。
      allowedControls: ['entitySelect', 'entityMultiSelect'],
      build: (value) => buildForeignKeyFilter('chargerId', value),
    },
    businessDate: {
      label: '业务日期',
      dataType: 'date',
      allowedControls: ['date', 'dateRange'],
      build: (value) => buildDateFilter('businessDate', value),
    },
    paymentDate: {
      label: '回款时间',
      dataType: 'date',
      allowedControls: ['date', 'dateRange'],
      build: (value) => buildDateFilter('paymentDate', value),
    },
    orderBeginDate: {
      label: '合同开始日期',
      dataType: 'date',
      allowedControls: ['date', 'dateRange'],
      build: (value) => buildDateFilter('orderBeginDate', value),
    },
    orderEndDate: {
      label: '合同结束日期',
      dataType: 'date',
      allowedControls: ['date', 'dateRange'],
      build: (value) => buildDateFilter('orderEndDate', value),
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
    orderAmount: {
      label: '合同金额',
      dataType: 'decimal',
      allowedControls: ['numberEqual', 'numberRange'],
      build: (value) => buildNumberFilter('orderAmount', value),
    },
    productAmount: {
      label: '产品金额',
      dataType: 'decimal',
      allowedControls: ['numberEqual', 'numberRange'],
      build: (value) => buildNumberFilter('productAmount', value),
    },
    totalReceivables: {
      label: '应收总额',
      dataType: 'decimal',
      allowedControls: ['numberEqual', 'numberRange'],
      build: (value) => buildNumberFilter('totalReceivables', value),
    },
    totalReceived: {
      label: '已收总额',
      dataType: 'decimal',
      allowedControls: ['numberEqual', 'numberRange'],
      build: (value) => buildNumberFilter('totalReceived', value),
    },
    totalUncollected: {
      label: '未收余额',
      dataType: 'decimal',
      allowedControls: ['numberEqual', 'numberRange'],
      build: (value) => buildNumberFilter('totalUncollected', value),
    },
    serialNumber: {
      label: '编号',
      dataType: 'string',
      searchable: true,
      allowedControls: ['text'],
      build: (value) => buildStringFilter('serialNumber', value),
    },
    orderTitle: {
      label: '合同标题',
      dataType: 'string',
      searchable: true,
      allowedControls: ['text'],
      build: (value) => buildStringFilter('orderTitle', value),
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
      { fieldKey: 'orderStatus', control: 'multiSelect' },
      { fieldKey: 'customerId', control: 'entityMultiSelect' },
      { fieldKey: 'businessDate', control: 'dateRange' },
    ],
    keyword: {
      enabled: true,
      fieldKeys: ['serialNumber', 'orderTitle', 'chargerName'],
      placeholder: '编号/合同标题/负责人',
    },
  },
});
