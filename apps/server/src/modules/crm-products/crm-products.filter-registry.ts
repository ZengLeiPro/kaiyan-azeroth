import {
  PRODUCT_TYPE_LABELS,
  PRODUCT_UNIT_LABELS,
  RECORD_STATUS_LABELS,
} from '@ky-azeroth/shared/constants/status-labels';

import {
  buildDateFilter,
  buildEnumFilter,
  buildNumberFilter,
  buildStringFilter,
  buildStringListFilter,
  defineFilterRegistry,
  toOptions,
} from '../../common/filter-scheme';

const CRM_PRODUCT_PAGE_KEY = 'crm.products';

const PRODUCT_TYPE_SET = new Set<string>(Object.keys(PRODUCT_TYPE_LABELS));
const PRODUCT_UNIT_SET = new Set<string>(Object.keys(PRODUCT_UNIT_LABELS));
const RECORD_STATUS_SET = new Set<string>(Object.keys(RECORD_STATUS_LABELS));

export const CRM_PRODUCT_FILTER_REGISTRY = defineFilterRegistry({
  pageKey: CRM_PRODUCT_PAGE_KEY,
  pageName: 'CRM 产品列表',
  fields: {
    productStatus: {
      label: '产品状态',
      dataType: 'enum',
      allowedControls: ['select', 'multiSelect'],
      // productStatus 用业务自由枚举（上架/下架/预售 等），这里不限白名单。
      build: (value) => buildStringListFilter('productStatus', value),
    },
    productTypes: {
      label: '产品类型',
      dataType: 'enum',
      allowedControls: ['select', 'multiSelect'],
      optionsSource: () => toOptions(PRODUCT_TYPE_LABELS),
      build: (value) => buildEnumFilter('productTypes', PRODUCT_TYPE_SET, value),
    },
    productUnit: {
      label: '单位',
      dataType: 'enum',
      allowedControls: ['select', 'multiSelect'],
      optionsSource: () => toOptions(PRODUCT_UNIT_LABELS),
      build: (value) => buildEnumFilter('productUnit', PRODUCT_UNIT_SET, value),
    },
    status: {
      label: '记录状态',
      dataType: 'enum',
      allowedControls: ['select', 'multiSelect'],
      optionsSource: () => toOptions(RECORD_STATUS_LABELS),
      build: (value) => buildEnumFilter('status', RECORD_STATUS_SET, value),
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
    standardPrice: {
      label: '标准价格',
      dataType: 'decimal',
      allowedControls: ['numberEqual', 'numberRange'],
      build: (value) => buildNumberFilter('standardPrice', value),
    },
    productName: {
      label: '产品名称',
      dataType: 'string',
      searchable: true,
      allowedControls: ['text'],
      build: (value) => buildStringFilter('productName', value),
    },
    productNumber: {
      label: '产品编号',
      dataType: 'string',
      searchable: true,
      allowedControls: ['text'],
      build: (value) => buildStringFilter('productNumber', value),
    },
  },
  defaults: {
    fields: [
      { fieldKey: 'productStatus', control: 'multiSelect' },
      { fieldKey: 'productTypes', control: 'multiSelect' },
    ],
    keyword: {
      enabled: true,
      fieldKeys: ['productName', 'productNumber'],
      placeholder: '产品名称/编号',
    },
  },
});
