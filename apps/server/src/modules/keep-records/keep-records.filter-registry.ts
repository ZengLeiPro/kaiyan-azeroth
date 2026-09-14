import { KEEP_RECORD_STATUS_LABELS } from '@ky-azeroth/shared/constants/status-labels';
import { KEEP_RECORD_TYPE } from '@ky-azeroth/shared/constants/status-values';

import {
  buildDateFilter,
  buildEnumFilter,
  buildForeignKeyFilter,
  buildStringFilterWithRelationFallback,
  defineFilterRegistry,
  toOptions,
} from '../../common/filter-scheme';

const KEEP_RECORDS_PAGE_KEY = 'crm.keep_records';

const KEEP_RECORD_TYPE_LABELS_MAP: Record<string, string> = {
  [KEEP_RECORD_TYPE.PHONE]: '电话',
  [KEEP_RECORD_TYPE.ONLINE]: '网络',
  [KEEP_RECORD_TYPE.FACE_TO_FACE]: '面访',
  [KEEP_RECORD_TYPE.OTHER]: '其他',
};

const KEEP_RECORD_TYPE_SET = new Set<string>(Object.keys(KEEP_RECORD_TYPE_LABELS_MAP));
const KEEP_RECORD_STATUS_SET = new Set<string>(Object.keys(KEEP_RECORD_STATUS_LABELS));

export const KEEP_RECORD_FILTER_REGISTRY = defineFilterRegistry({
  pageKey: KEEP_RECORDS_PAGE_KEY,
  pageName: '跟进记录列表',
  fields: {
    keepRecordType: {
      label: '跟进类型',
      dataType: 'enum',
      allowedControls: ['select', 'multiSelect'],
      optionsSource: () => toOptions(KEEP_RECORD_TYPE_LABELS_MAP),
      build: (value) => buildEnumFilter('keepRecordType', KEEP_RECORD_TYPE_SET, value),
    },
    keepRecordStatus: {
      label: '跟进状态',
      dataType: 'enum',
      allowedControls: ['select', 'multiSelect'],
      optionsSource: () => toOptions(KEEP_RECORD_STATUS_LABELS),
      build: (value) => buildEnumFilter('keepRecordStatus', KEEP_RECORD_STATUS_SET, value),
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
      // 注意：keep_record 自身有 chargerId 字段，但数据范围过滤走双路径 OR
      // (chargerId IN scope OR customer.chargerId IN scope)。service 层在
      // baseWhere 里手拼 OR，并传 chargerScope:null 给 applier 阻止默认注入。
      allowedControls: ['entitySelect', 'entityMultiSelect'],
      build: (value) => buildForeignKeyFilter('chargerId', value),
    },
    keepRecordTime: {
      label: '跟进时间',
      dataType: 'date',
      allowedControls: ['date', 'dateRange'],
      build: (value) => buildDateFilter('keepRecordTime', value),
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
      { fieldKey: 'keepRecordType', control: 'multiSelect' },
      { fieldKey: 'customerId', control: 'entityMultiSelect' },
      { fieldKey: 'keepRecordTime', control: 'dateRange' },
    ],
    keyword: {
      enabled: true,
      fieldKeys: ['chargerName'],
      placeholder: '负责人',
    },
  },
});
