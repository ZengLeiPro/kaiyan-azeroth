import {
  PROJECT_TICKET_PRIORITY_LABELS,
  PROJECT_TICKET_STATUS_LABELS,
  PROJECT_TICKET_TYPE_LABELS,
} from '@ky-azeroth/shared/constants';

import {
  buildDateFilter,
  buildEnumFilter,
  buildForeignKeyFilter,
  buildStringFilter,
  defineFilterRegistry,
  toOptions,
} from '../../common/filter-scheme';

const PROJECT_TICKET_PAGE_KEY = 'projects.tickets';

const STATUS_SET = new Set<string>(Object.keys(PROJECT_TICKET_STATUS_LABELS));
const PRIORITY_SET = new Set<string>(Object.keys(PROJECT_TICKET_PRIORITY_LABELS));
const TYPE_SET = new Set<string>(Object.keys(PROJECT_TICKET_TYPE_LABELS));

export const PROJECT_TICKET_FILTER_REGISTRY = defineFilterRegistry({
  pageKey: PROJECT_TICKET_PAGE_KEY,
  pageName: '项目工单列表',
  fields: {
    status: {
      label: '状态',
      dataType: 'enum',
      allowedControls: ['select', 'multiSelect'],
      optionsSource: () => toOptions(PROJECT_TICKET_STATUS_LABELS),
      build: (value) => buildEnumFilter('status', STATUS_SET, value),
    },
    ticketType: {
      label: '类型',
      dataType: 'enum',
      allowedControls: ['select', 'multiSelect'],
      optionsSource: () => toOptions(PROJECT_TICKET_TYPE_LABELS),
      build: (value) => buildEnumFilter('ticketType', TYPE_SET, value),
    },
    priority: {
      label: '优先级',
      dataType: 'enum',
      allowedControls: ['select', 'multiSelect'],
      optionsSource: () => toOptions(PROJECT_TICKET_PRIORITY_LABELS),
      build: (value) => buildEnumFilter('priority', PRIORITY_SET, value),
    },
    projectId: {
      label: '所属项目',
      dataType: 'foreignKey',
      entity: 'project',
      allowedControls: ['entitySelect', 'entityMultiSelect'],
      build: (value) => buildForeignKeyFilter('projectId', value),
    },
    assigneeId: {
      label: '接单人',
      dataType: 'foreignKey',
      entity: 'employee',
      allowedControls: ['entitySelect', 'entityMultiSelect'],
      build: (value) => buildForeignKeyFilter('assigneeId', value),
    },
    dispatcherId: {
      label: '派单人',
      dataType: 'foreignKey',
      entity: 'employee',
      allowedControls: ['entitySelect', 'entityMultiSelect'],
      build: (value) => buildForeignKeyFilter('dispatcherId', value),
    },
    dueDate: {
      label: '截止时间',
      dataType: 'date',
      allowedControls: ['date', 'dateRange'],
      build: (value) => buildDateFilter('dueDate', value),
    },
    createdAt: {
      label: '创建时间',
      dataType: 'date',
      allowedControls: ['date', 'dateRange'],
      build: (value) => buildDateFilter('createdAt', value),
    },
    updatedAt: {
      label: '更新时间',
      dataType: 'date',
      allowedControls: ['date', 'dateRange'],
      build: (value) => buildDateFilter('updatedAt', value),
    },
    ticketNo: {
      label: '编号',
      dataType: 'string',
      searchable: true,
      allowedControls: ['text'],
      build: (value) => buildStringFilter('ticketNo', value),
    },
    title: {
      label: '标题',
      dataType: 'string',
      searchable: true,
      allowedControls: ['text'],
      build: (value) => buildStringFilter('title', value),
    },
  },
  defaults: {
    fields: [
      { fieldKey: 'status', control: 'multiSelect' },
      { fieldKey: 'priority', control: 'multiSelect' },
      { fieldKey: 'ticketType', control: 'multiSelect' },
      { fieldKey: 'dueDate', control: 'dateRange' },
    ],
    keyword: {
      enabled: true,
      fieldKeys: ['ticketNo', 'title'],
      placeholder: '编号/标题',
    },
  },
});
