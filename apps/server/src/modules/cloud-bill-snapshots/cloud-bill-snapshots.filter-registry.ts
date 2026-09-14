import {
  buildDateFilter,
  buildEnumFilter,
  buildStringFilter,
  defineFilterRegistry,
  toOptions,
} from '../../common/filter-scheme';

const VENDOR_LABELS = { aliyun: '阿里云' };
const VENDOR_SET = new Set(Object.keys(VENDOR_LABELS));

export const CLOUD_BILL_SNAPSHOT_FILTER_REGISTRY = defineFilterRegistry({
  pageKey: 'ops.cloud_cost.bills',
  pageName: '云账单快照列表',
  fields: {
    keyword: {
      label: '关键词',
      dataType: 'string',
      allowedControls: ['text'],
      build: (value) => {
        const billingCycle = buildStringFilter('billingCycle', value);
        if (!billingCycle) return null;
        return {
          OR: [billingCycle, buildStringFilter('vendor', value)],
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
    billingCycle: {
      label: '账期',
      dataType: 'string',
      allowedControls: ['text'],
      build: (value) => buildStringFilter('billingCycle', value),
    },
    snapshotDate: {
      label: '快照日期',
      dataType: 'date',
      allowedControls: ['dateRange'],
      build: (value) => buildDateFilter('snapshotDate', value),
    },
  },
  defaults: {
    fields: [{ fieldKey: 'keyword', control: 'text' }],
    keyword: { enabled: false, fieldKeys: [], placeholder: null },
  },
});
