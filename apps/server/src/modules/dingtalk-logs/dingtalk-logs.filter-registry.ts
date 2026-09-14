import {
  buildDateFilter,
  buildEnumFilter,
  buildForeignKeyFilter,
  buildStringFilter,
  defineFilterRegistry,
} from '../../common/filter-scheme';

const DINGTALK_LOG_PAGE_KEY = 'reports.dingtalk_logs';

export const DINGTALK_LOG_FILTER_REGISTRY = defineFilterRegistry({
  pageKey: DINGTALK_LOG_PAGE_KEY,
  pageName: '钉钉日志列表',
  fields: {
    creatorId: {
      label: '提交人',
      dataType: 'foreignKey',
      entity: 'employee',
      allowedControls: ['entitySelect', 'entityMultiSelect'],
      build: (value) => buildForeignKeyFilter('creatorId', value),
    },
    createTime: {
      label: '创建时间',
      dataType: 'date',
      allowedControls: ['date', 'dateRange'],
      build: (value) => buildDateFilter('createTime', value),
    },
    syncedAt: {
      label: '同步时间',
      dataType: 'date',
      allowedControls: ['date', 'dateRange'],
      build: (value) => buildDateFilter('syncedAt', value),
    },
    templateName: {
      label: '日志模板',
      dataType: 'string',
      searchable: true,
      allowedControls: ['text'],
      build: (value) => buildStringFilter('templateName', value),
    },
    creatorName: {
      label: '提交人姓名',
      dataType: 'string',
      searchable: true,
      allowedControls: ['text'],
      build: (value) => buildStringFilter('creatorName', value),
    },
    deptName: {
      label: '部门',
      dataType: 'string',
      searchable: true,
      allowedControls: ['text'],
      build: (value) => buildStringFilter('deptName', value),
    },
    source: {
      label: '来源',
      dataType: 'enum',
      allowedControls: ['select', 'multiSelect'],
      optionsSource: () => [
        { value: 'dingtalk', label: '钉钉同步' },
        { value: 'local', label: '本地新增' },
      ],
      build: (value) => buildEnumFilter('source', new Set(['dingtalk', 'local']), value),
    },
  },
  defaults: {
    fields: [{ fieldKey: 'createTime', control: 'dateRange' }],
    keyword: {
      enabled: true,
      fieldKeys: ['templateName', 'creatorName'],
      placeholder: '模板/提交人',
    },
  },
});
