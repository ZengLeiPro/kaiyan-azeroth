import { buildStringFilter, defineFilterRegistry } from '../../common/filter-scheme';

const DINGTALK_CALENDAR_EVENT_PAGE_KEY = 'reports.calendar_events';

export const DINGTALK_CALENDAR_EVENT_FILTER_REGISTRY = defineFilterRegistry({
  pageKey: DINGTALK_CALENDAR_EVENT_PAGE_KEY,
  pageName: '日历事件列表',
  fields: {
    title: {
      label: '日程标题',
      dataType: 'string',
      searchable: true,
      allowedControls: ['text'],
      build: (value) => buildStringFilter('title', value),
    },
  },
  defaults: {
    fields: [],
    keyword: {
      enabled: true,
      fieldKeys: ['title'],
      placeholder: '标题/创建者/地点',
    },
  },
});
