import { EFFORT_RECORD_TYPE_LABELS, EFFORT_WORK_TYPE_LABELS } from '@ky-azeroth/shared/constants';

import {
  buildDateFilter,
  buildEnumFilter,
  buildForeignKeyFilter,
  buildNumberFilter,
  buildStringFilter,
  defineFilterRegistry,
  toOptions,
} from '../../common/filter-scheme';

const EFFORT_RECORD_PAGE_KEY = 'projects.effort_records';

const RECORD_TYPE_SET = new Set<string>(Object.keys(EFFORT_RECORD_TYPE_LABELS));
const WORK_TYPE_SET = new Set<string>(Object.keys(EFFORT_WORK_TYPE_LABELS));

export const EFFORT_RECORD_FILTER_REGISTRY = defineFilterRegistry({
  pageKey: EFFORT_RECORD_PAGE_KEY,
  pageName: '工时记录列表',
  fields: {
    recordType: {
      label: '记录类型',
      dataType: 'enum',
      allowedControls: ['select', 'multiSelect'],
      optionsSource: () => toOptions(EFFORT_RECORD_TYPE_LABELS),
      build: (value) => buildEnumFilter('recordType', RECORD_TYPE_SET, value),
    },
    workType: {
      label: '工时类型',
      dataType: 'enum',
      allowedControls: ['select', 'multiSelect'],
      optionsSource: () => toOptions(EFFORT_WORK_TYPE_LABELS),
      build: (value) => buildEnumFilter('workType', WORK_TYPE_SET, value),
    },
    projectId: {
      label: '项目',
      dataType: 'foreignKey',
      entity: 'project',
      allowedControls: ['entitySelect', 'entityMultiSelect'],
      build: (value) => buildForeignKeyFilter('projectId', value),
    },
    ownerId: {
      label: '记录人',
      dataType: 'foreignKey',
      entity: 'employee',
      // 约定：工时的 DataScope 走 ownerId（哪怕组织没有开启 scope，管理员也会想按记录人筛）
      isScopeField: true,
      allowedControls: ['entitySelect', 'entityMultiSelect'],
      build: (value) => buildForeignKeyFilter('ownerId', value),
    },
    workDate: {
      label: '工时日期',
      dataType: 'date',
      // 数据现状：约 89% 的 effort_records 行 workDate 为 NULL（云效只回传 startDate/endDate）。
      // nullFallbackField 让 workDate=NULL 时按 startDate 区间兜底筛选，
      // 与 service 层旧 query.startDate/endDate 兜底语义保持一致；两者可共存。
      allowedControls: ['date', 'dateRange'],
      build: (value) => buildDateFilter('workDate', value, { nullFallbackField: 'startDate' }),
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
    actualTime: {
      label: '实际工时',
      dataType: 'decimal',
      allowedControls: ['numberEqual', 'numberRange'],
      build: (value) => buildNumberFilter('actualTime', value),
    },
    ownerName: {
      label: '记录人姓名',
      dataType: 'string',
      searchable: true,
      allowedControls: ['text'],
      build: (value) => buildStringFilter('ownerName', value),
    },
    description: {
      label: '工作描述',
      dataType: 'string',
      // description 可能是较长的工作说明文本，保留为 searchable 以支持按内容搜索
      // （长度上限由 zod schema 控制）。若后续发现慢查询，再下调为非 searchable。
      searchable: true,
      allowedControls: ['text'],
      build: (value) => buildStringFilter('description', value),
    },
  },
  defaults: {
    fields: [
      { fieldKey: 'recordType', control: 'multiSelect' },
      { fieldKey: 'workType', control: 'multiSelect' },
      { fieldKey: 'projectId', control: 'entityMultiSelect' },
      { fieldKey: 'workDate', control: 'dateRange' },
    ],
    keyword: {
      enabled: true,
      fieldKeys: ['ownerName', 'description'],
      placeholder: '记录人/工作描述',
    },
  },
});
