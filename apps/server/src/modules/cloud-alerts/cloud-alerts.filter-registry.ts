import {
  CLOUD_ALERT_CATEGORY_LABELS,
  CLOUD_ALERT_LEVEL_LABELS,
  CLOUD_ALERT_STATUS_LABELS,
} from '@ky-azeroth/shared/constants/status-labels';

import {
  buildDateFilter,
  buildEnumFilter,
  buildStringFilter,
  defineFilterRegistry,
  toOptions,
} from '../../common/filter-scheme';

const VENDOR_LABELS = { aliyun: '阿里云' };

const VENDOR_SET = new Set(Object.keys(VENDOR_LABELS));
const LEVEL_SET = new Set(Object.keys(CLOUD_ALERT_LEVEL_LABELS));
const CATEGORY_SET = new Set(Object.keys(CLOUD_ALERT_CATEGORY_LABELS));
const STATUS_SET = new Set(Object.keys(CLOUD_ALERT_STATUS_LABELS));

export const CLOUD_ALERT_FILTER_REGISTRY = defineFilterRegistry({
  pageKey: 'ops.cloud_cost.alerts',
  pageName: '云成本预警列表',
  fields: {
    keyword: {
      label: '关键词',
      dataType: 'string',
      allowedControls: ['text'],
      build: (value) => {
        const title = buildStringFilter('title', value);
        if (!title) return null;
        return {
          OR: [
            title,
            buildStringFilter('resourceKey', value),
            buildStringFilter('resourceType', value),
          ],
        };
      },
    },
    vendor: {
      label: '厂商',
      dataType: 'enum',
      allowedControls: ['select'],
      optionsSource: () => toOptions(VENDOR_LABELS),
      build: (value) => buildEnumFilter('vendor', VENDOR_SET, value),
    },
    level: {
      label: '等级',
      dataType: 'enum',
      allowedControls: ['select'],
      optionsSource: () => toOptions(CLOUD_ALERT_LEVEL_LABELS),
      build: (value) => buildEnumFilter('level', LEVEL_SET, value),
    },
    category: {
      label: '类别',
      dataType: 'enum',
      allowedControls: ['select'],
      optionsSource: () => toOptions(CLOUD_ALERT_CATEGORY_LABELS),
      build: (value) => buildEnumFilter('category', CATEGORY_SET, value),
    },
    status: {
      label: '状态',
      dataType: 'enum',
      allowedControls: ['select'],
      optionsSource: () => toOptions(CLOUD_ALERT_STATUS_LABELS),
      build: (value) => buildEnumFilter('status', STATUS_SET, value),
    },
    triggeredAt: {
      label: '触发时间',
      dataType: 'date',
      allowedControls: ['dateRange'],
      build: (value) => buildDateFilter('triggeredAt', value),
    },
  },
  defaults: {
    fields: [{ fieldKey: 'keyword', control: 'text' }],
    keyword: { enabled: false, fieldKeys: [], placeholder: null },
  },
});
