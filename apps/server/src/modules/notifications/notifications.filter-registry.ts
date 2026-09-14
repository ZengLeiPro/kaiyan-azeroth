import {
  buildEnumFilter,
  defineFilterRegistry,
  type FilterFieldBuildValue,
} from '../../common/filter-scheme';

const NOTIFICATION_PAGE_KEY = 'system.notifications';

const NOTIFICATION_TYPE_LABELS: Record<string, string> = {
  system: '系统',
  approval: '待审批',
  inventory: '库存',
  order: '订单',
  task: '任务',
};
const NOTIFICATION_TYPE_SET = new Set(Object.keys(NOTIFICATION_TYPE_LABELS));

function buildReadStatusFilter(value: FilterFieldBuildValue): Record<string, unknown> | null {
  if (value === 'read') return { isRead: true };
  if (value === 'unread') return { isRead: false };
  return null;
}

export const NOTIFICATION_FILTER_REGISTRY = defineFilterRegistry({
  pageKey: NOTIFICATION_PAGE_KEY,
  pageName: '通知列表',
  fields: {
    type: {
      label: '通知类型',
      dataType: 'enum',
      allowedControls: ['multiSelect'],
      optionsSource: () =>
        Object.entries(NOTIFICATION_TYPE_LABELS).map(([value, label]) => ({ value, label })),
      build: (value) => buildEnumFilter('type', NOTIFICATION_TYPE_SET, value),
    },
    readStatus: {
      label: '阅读状态',
      dataType: 'enum',
      allowedControls: ['select'],
      optionsSource: () => [
        { value: 'unread', label: '未读' },
        { value: 'read', label: '已读' },
      ],
      build: buildReadStatusFilter,
    },
  },
  defaults: {
    fields: [
      { fieldKey: 'type', control: 'multiSelect', width: 'w-36' },
      { fieldKey: 'readStatus', control: 'select', width: 'w-28' },
    ],
    keyword: {
      enabled: false,
      fieldKeys: [],
    },
  },
});
