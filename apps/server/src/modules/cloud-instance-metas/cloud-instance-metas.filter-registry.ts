import { CLOUD_PRODUCT_CODE_VALUES } from '@ky-azeroth/shared/constants/cloud-cost';
import {
  CLOUD_OWNER_CATEGORY_LABELS,
  CLOUD_RENEWAL_INTENT_LABELS,
} from '@ky-azeroth/shared/constants/status-labels';

import {
  buildBooleanFilter,
  buildEnumFilter,
  buildStringFilter,
  defineFilterRegistry,
  toOptions,
} from '../../common/filter-scheme';

const VENDOR_LABELS = { aliyun: '阿里云' };
const PRODUCT_CODE_LABELS = Object.fromEntries(
  CLOUD_PRODUCT_CODE_VALUES.map((value) => [value, value])
);
const ARCHIVED_LABELS = { true: '已归档', false: '未归档' };

const VENDOR_SET = new Set(Object.keys(VENDOR_LABELS));
const PRODUCT_CODE_SET = new Set(CLOUD_PRODUCT_CODE_VALUES);
const OWNER_CATEGORY_SET = new Set(Object.keys(CLOUD_OWNER_CATEGORY_LABELS));
const RENEWAL_INTENT_SET = new Set(Object.keys(CLOUD_RENEWAL_INTENT_LABELS));

export const CLOUD_INSTANCE_META_FILTER_REGISTRY = defineFilterRegistry({
  pageKey: 'ops.cloud_cost.instances',
  pageName: '云实例元数据列表',
  fields: {
    keyword: {
      label: '关键词',
      dataType: 'string',
      allowedControls: ['text'],
      build: (value) => {
        const instanceId = buildStringFilter('instanceId', value);
        if (!instanceId) return null;
        return {
          OR: [
            instanceId,
            buildStringFilter('alias', value),
            buildStringFilter('ownerName', value),
            buildStringFilter('purpose', value),
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
    productCode: {
      label: '产品代码',
      dataType: 'enum',
      allowedControls: ['select'],
      optionsSource: () => toOptions(PRODUCT_CODE_LABELS),
      build: (value) => buildEnumFilter('productCode', PRODUCT_CODE_SET, value),
    },
    ownerCategory: {
      label: '归属类别',
      dataType: 'enum',
      allowedControls: ['select'],
      optionsSource: () => toOptions(CLOUD_OWNER_CATEGORY_LABELS),
      build: (value) => buildEnumFilter('ownerCategory', OWNER_CATEGORY_SET, value),
    },
    renewalIntent: {
      label: '续费意愿',
      dataType: 'enum',
      allowedControls: ['select'],
      optionsSource: () => toOptions(CLOUD_RENEWAL_INTENT_LABELS),
      build: (value) => buildEnumFilter('renewalIntent', RENEWAL_INTENT_SET, value),
    },
    archived: {
      label: '归档状态',
      dataType: 'boolean',
      allowedControls: ['select'],
      optionsSource: () => toOptions(ARCHIVED_LABELS),
      build: (value) => buildBooleanFilter('archived', value),
    },
  },
  defaults: {
    fields: [{ fieldKey: 'keyword', control: 'text' }],
    keyword: { enabled: false, fieldKeys: [], placeholder: null },
  },
});
