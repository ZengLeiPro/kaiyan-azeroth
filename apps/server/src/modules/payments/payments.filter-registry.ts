import { PAYMENT_DIRECTION, PAYMENT_REFUND_TYPE } from '@ky-azeroth/shared/constants';
import { RECORD_STATUS_LABELS } from '@ky-azeroth/shared/constants/status-labels';

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

const PAYMENT_PAGE_KEY = 'crm.payments';

const RECORD_STATUS_SET = new Set<string>(Object.keys(RECORD_STATUS_LABELS));

const PAYMENT_DIRECTION_LABELS = {
  [PAYMENT_DIRECTION.IN]: '回款',
  [PAYMENT_DIRECTION.OUT]: '退款',
} as const;
const PAYMENT_DIRECTION_SET = new Set<string>(Object.values(PAYMENT_DIRECTION));

const PAYMENT_REFUND_TYPE_LABELS = Object.values(PAYMENT_REFUND_TYPE).reduce<
  Record<string, string>
>((acc, value) => {
  acc[value] = value;
  return acc;
}, {});
const PAYMENT_REFUND_TYPE_SET = new Set<string>(Object.values(PAYMENT_REFUND_TYPE));

// 审批流状态白名单（draft 表示未提交审批 / pending 审批中 / approved 通过 / rejected 驳回）
// 之所以在本文件本地定义而不抽到 shared/constants，是因为现有项目未沉淀统一的
// flowStatus 常量（多个模块各自字符串硬编码），扩展到 shared 是另外的重构。
const FLOW_STATUS_LABELS = {
  draft: '草稿',
  pending: '审批中',
  approved: '已通过',
  rejected: '已驳回',
} as const;
const FLOW_STATUS_SET = new Set<string>(Object.keys(FLOW_STATUS_LABELS));

export const PAYMENT_FILTER_REGISTRY = defineFilterRegistry({
  pageKey: PAYMENT_PAGE_KEY,
  pageName: '回款列表',
  fields: {
    status: {
      label: '记录状态',
      dataType: 'enum',
      allowedControls: ['select', 'multiSelect'],
      optionsSource: () => toOptions(RECORD_STATUS_LABELS),
      build: (value) => buildEnumFilter('status', RECORD_STATUS_SET, value),
    },
    paymentType: {
      label: '付款方式',
      dataType: 'enum',
      allowedControls: ['select', 'multiSelect'],
      // paymentType 是业务自由文本（"对公/对私/现金/支票..."），不在 status-values
      // 注册表里维护枚举，因此不限制白名单；前端下拉选项仍由页面本地枚举提供。
      build: (value) => buildStringListFilter('paymentType', value),
    },
    direction: {
      label: '方向',
      dataType: 'enum',
      allowedControls: ['select', 'multiSelect'],
      optionsSource: () => toOptions(PAYMENT_DIRECTION_LABELS),
      build: (value) => buildEnumFilter('direction', PAYMENT_DIRECTION_SET, value),
    },
    refundType: {
      label: '退款类型',
      dataType: 'enum',
      allowedControls: ['select', 'multiSelect'],
      optionsSource: () => toOptions(PAYMENT_REFUND_TYPE_LABELS),
      build: (value) => buildEnumFilter('refundType', PAYMENT_REFUND_TYPE_SET, value),
    },
    flowStatus: {
      label: '审批状态',
      dataType: 'enum',
      allowedControls: ['select', 'multiSelect'],
      optionsSource: () => toOptions(FLOW_STATUS_LABELS),
      build: (value) => buildEnumFilter('flowStatus', FLOW_STATUS_SET, value),
    },
    relatedPaymentId: {
      label: '关联原回款',
      dataType: 'foreignKey',
      entity: 'payment',
      allowedControls: ['entitySelect', 'entityMultiSelect'],
      build: (value) => buildForeignKeyFilter('relatedPaymentId', value),
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
    chargerId: {
      label: '负责人',
      dataType: 'foreignKey',
      entity: 'employee',
      // 注意：payment 本身有 chargerId 字段，但数据范围过滤走 customer.chargerId。
      // 因此这里不标记 isScopeField，service 会在 baseWhere 里自拼 customer 侧过滤，
      // 同时让 applier 照常把用户前端选的 chargerId 作为普通过滤处理。
      allowedControls: ['entitySelect', 'entityMultiSelect'],
      build: (value) => buildForeignKeyFilter('chargerId', value),
    },
    businessDate: {
      label: '业务日期',
      dataType: 'date',
      allowedControls: ['date', 'dateRange'],
      build: (value) => buildDateFilter('businessDate', value),
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
    paymentAmount: {
      label: '回款金额',
      dataType: 'decimal',
      allowedControls: ['numberEqual', 'numberRange'],
      build: (value) => buildNumberFilter('paymentAmount', value),
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
    tradeSerialNumber: {
      label: '交易流水号',
      dataType: 'string',
      searchable: true,
      allowedControls: ['text'],
      build: (value) => buildStringFilter('tradeSerialNumber', value),
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
      { fieldKey: 'paymentType', control: 'multiSelect' },
      { fieldKey: 'customerId', control: 'entityMultiSelect' },
      { fieldKey: 'businessDate', control: 'dateRange' },
    ],
    keyword: {
      enabled: true,
      fieldKeys: ['serialNumber', 'subject', 'tradeSerialNumber'],
      placeholder: '编号/业务摘要/交易流水号',
    },
  },
});
