import {
  INVOICE_ITEM_TYPE_LABELS,
  INVOICE_STATUS_LABELS,
  INVOICE_TYPE_LABELS,
  RECORD_STATUS_LABELS,
} from '@ky-azeroth/shared/constants/status-labels';

import {
  buildDateFilter,
  buildEnumFilter,
  buildForeignKeyFilter,
  buildNumberFilter,
  buildStringFilter,
  defineFilterRegistry,
  toOptions,
} from '../../common/filter-scheme';

const INVOICE_PAGE_KEY = 'crm.invoices';

const INVOICE_STATUS_SET = new Set<string>(Object.keys(INVOICE_STATUS_LABELS));
const INVOICE_TYPE_SET = new Set<string>(Object.keys(INVOICE_TYPE_LABELS));
const INVOICE_ITEM_TYPE_SET = new Set<string>(Object.keys(INVOICE_ITEM_TYPE_LABELS));
const RECORD_STATUS_SET = new Set<string>(Object.keys(RECORD_STATUS_LABELS));

export const INVOICE_FILTER_REGISTRY = defineFilterRegistry({
  pageKey: INVOICE_PAGE_KEY,
  pageName: '开票列表',
  fields: {
    invoiceStatus: {
      label: '开票状态',
      dataType: 'enum',
      allowedControls: ['select', 'multiSelect'],
      optionsSource: () => toOptions(INVOICE_STATUS_LABELS),
      build: (value) => buildEnumFilter('invoiceStatus', INVOICE_STATUS_SET, value),
    },
    invoiceType: {
      label: '发票类型',
      dataType: 'enum',
      allowedControls: ['select', 'multiSelect'],
      optionsSource: () => toOptions(INVOICE_TYPE_LABELS),
      build: (value) => buildEnumFilter('invoiceType', INVOICE_TYPE_SET, value),
    },
    itemType: {
      label: '开票项目类型',
      dataType: 'enum',
      allowedControls: ['select', 'multiSelect'],
      optionsSource: () => toOptions(INVOICE_ITEM_TYPE_LABELS),
      build: (value) => buildEnumFilter('itemType', INVOICE_ITEM_TYPE_SET, value),
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
    saleOrderId: {
      label: '关联合同',
      dataType: 'foreignKey',
      entity: 'saleOrder',
      allowedControls: ['entitySelect', 'entityMultiSelect'],
      build: (value) => buildForeignKeyFilter('saleOrderId', value),
    },
    invoiceDate: {
      label: '开票日期',
      dataType: 'date',
      allowedControls: ['date', 'dateRange'],
      build: (value) => buildDateFilter('invoiceDate', value),
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
    invoiceAmount: {
      label: '发票金额',
      dataType: 'decimal',
      allowedControls: ['numberEqual', 'numberRange'],
      build: (value) => buildNumberFilter('invoiceAmount', value),
    },
    serialNumber: {
      label: '编号',
      dataType: 'string',
      searchable: true,
      allowedControls: ['text'],
      build: (value) => buildStringFilter('serialNumber', value),
    },
    subject: {
      label: '业务摘要',
      dataType: 'string',
      searchable: true,
      allowedControls: ['text'],
      build: (value) => buildStringFilter('subject', value),
    },
    invoiceNumber: {
      label: '发票号码',
      dataType: 'string',
      searchable: true,
      allowedControls: ['text'],
      build: (value) => buildStringFilter('invoiceNumber', value),
    },
    title: {
      label: '抬头',
      dataType: 'string',
      searchable: true,
      allowedControls: ['text'],
      build: (value) => buildStringFilter('title', value),
    },
    taxIdentifyNum: {
      label: '纳税识别号',
      dataType: 'string',
      searchable: true,
      allowedControls: ['text'],
      build: (value) => buildStringFilter('taxIdentifyNum', value),
    },
  },
  defaults: {
    fields: [
      { fieldKey: 'invoiceStatus', control: 'multiSelect' },
      { fieldKey: 'customerId', control: 'entityMultiSelect' },
      { fieldKey: 'invoiceDate', control: 'dateRange' },
    ],
    keyword: {
      enabled: true,
      fieldKeys: ['serialNumber', 'subject', 'invoiceNumber', 'title'],
      placeholder: '编号/业务摘要/发票号/抬头',
    },
  },
});
