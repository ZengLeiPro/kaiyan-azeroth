import {
  buildDateFilter,
  buildStringFilter,
  defineFilterRegistry,
} from '../../common/filter-scheme';

const EMPLOYEE_LEAVE_PAGE_KEY = 'reports.employee_leaves';

export const EMPLOYEE_LEAVE_FILTER_REGISTRY = defineFilterRegistry({
  pageKey: EMPLOYEE_LEAVE_PAGE_KEY,
  pageName: '员工离职记录列表',
  fields: {
    leaveTime: {
      label: '离职时间',
      dataType: 'date',
      allowedControls: ['date', 'dateRange'],
      build: (value) => buildDateFilter('leaveTime', value),
    },
    syncedAt: {
      label: '同步时间',
      dataType: 'date',
      allowedControls: ['date', 'dateRange'],
      build: (value) => buildDateFilter('syncedAt', value),
    },
    name: {
      label: '姓名',
      dataType: 'string',
      searchable: true,
      allowedControls: ['text'],
      build: (value) => buildStringFilter('name', value),
    },
    mobile: {
      label: '手机号',
      dataType: 'string',
      searchable: true,
      allowedControls: ['text'],
      build: (value) => buildStringFilter('mobile', value),
    },
    dingtalkUserId: {
      label: '钉钉用户ID',
      dataType: 'string',
      searchable: false,
      allowedControls: ['text'],
      build: (value) => buildStringFilter('dingtalkUserId', value),
    },
  },
  defaults: {
    fields: [{ fieldKey: 'leaveTime', control: 'dateRange' }],
    keyword: {
      enabled: true,
      fieldKeys: ['name', 'mobile'],
      placeholder: '姓名/手机号',
    },
  },
});
