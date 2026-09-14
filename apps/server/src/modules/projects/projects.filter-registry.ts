import {
  PROJECT_CATEGORY_LABELS,
  PROJECT_STATUS_LABELS,
} from '@ky-azeroth/shared/constants/status-labels';

import {
  buildDateFilter,
  buildEnumFilter,
  buildForeignKeyFilter,
  buildStringFilter,
  defineFilterRegistry,
  toOptions,
} from '../../common/filter-scheme';

const PROJECT_PAGE_KEY = 'projects.list';

const PROJECT_STATUS_SET = new Set<string>(Object.keys(PROJECT_STATUS_LABELS));
const PROJECT_CATEGORY_SET = new Set<string>(Object.keys(PROJECT_CATEGORY_LABELS));

export const PROJECT_FILTER_REGISTRY = defineFilterRegistry({
  pageKey: PROJECT_PAGE_KEY,
  pageName: '项目列表',
  fields: {
    status: {
      label: '项目状态',
      dataType: 'enum',
      allowedControls: ['select', 'multiSelect'],
      optionsSource: () => toOptions(PROJECT_STATUS_LABELS),
      build: (value) => buildEnumFilter('status', PROJECT_STATUS_SET, value),
    },
    category: {
      label: '项目分类',
      dataType: 'enum',
      allowedControls: ['select', 'multiSelect'],
      optionsSource: () => toOptions(PROJECT_CATEGORY_LABELS),
      build: (value) => buildEnumFilter('category', PROJECT_CATEGORY_SET, value),
    },
    ownerId: {
      label: '负责人',
      dataType: 'foreignKey',
      entity: 'employee',
      // Project 用 ownerId 作为负责人字段，非 chargerId。标记 isScopeField=true
      // 让 FilterApplier 自动把 chargerScope 注入到 ownerId。
      isScopeField: true,
      allowedControls: ['entitySelect', 'entityMultiSelect'],
      build: (value) => buildForeignKeyFilter('ownerId', value),
    },
    customerId: {
      label: '客户',
      dataType: 'foreignKey',
      entity: 'customer',
      allowedControls: ['entitySelect', 'entityMultiSelect'],
      build: (value) => buildForeignKeyFilter('customerId', value),
    },
    startDate: {
      label: '开始日期',
      dataType: 'date',
      allowedControls: ['date', 'dateRange'],
      build: (value) => buildDateFilter('startDate', value),
    },
    endDate: {
      label: '结束日期',
      dataType: 'date',
      allowedControls: ['date', 'dateRange'],
      build: (value) => buildDateFilter('endDate', value),
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
    name: {
      label: '项目名称',
      dataType: 'string',
      searchable: true,
      allowedControls: ['text'],
      build: (value) => buildStringFilter('name', value),
    },
    ownerName: {
      label: '负责人姓名',
      dataType: 'string',
      searchable: true,
      allowedControls: ['text'],
      build: (value) => buildStringFilter('ownerName', value),
    },
    /**
     * 总工时（聚合字段）：min/max 范围由 ProjectsService.findAll 单独从 rawQuery
     * 解析后在内存层过滤；FilterApplier 这里不参与 Prisma where 拼装（build 返回 null），
     * 仅为前端 useFilterScheme 注册渲染元数据（numberRange 控件）。
     */
    totalHours: {
      label: '总工时',
      dataType: 'decimal',
      allowedControls: ['numberRange'],
      build: () => null,
    },
  },
  defaults: {
    fields: [
      { fieldKey: 'status', control: 'multiSelect' },
      { fieldKey: 'category', control: 'multiSelect' },
      { fieldKey: 'ownerId', control: 'entitySelect' },
      { fieldKey: 'totalHours', control: 'numberRange' },
    ],
    keyword: {
      enabled: true,
      fieldKeys: ['name', 'ownerName'],
      placeholder: '项目名称/负责人',
    },
  },
});
