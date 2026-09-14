import { APPROVAL_INSTANCE_STATUS, KEEP_RECORD_SOURCE } from '@ky-azeroth/shared/constants';
import {
  CONTACT_STATUS_LABELS,
  CUSTOMER_LEVEL_LABELS,
  CUSTOMER_RELATIONSHIP_LABELS,
  CUSTOMER_SOURCE_LABELS,
  DEAL_STATUS_LABELS,
  INDUSTRY_LABELS,
  INTENT_TEMPERATURE_LABELS,
  LEAD_PROGRESS_STATUS_LABELS,
  LEAD_STAGE_LABELS,
  LEAD_VALIDITY_LABELS,
  RECORD_STATUS_LABELS,
} from '@ky-azeroth/shared/constants/status-labels';
import {
  HAS_CONTACT_PHONE_OPTIONS,
  INDUSTRY_VALUES,
} from '@ky-azeroth/shared/constants/status-values';

import {
  buildDateFilter,
  buildStringFilterWithRelationFallback,
  defineFilterRegistry,
  escapeLikeChars,
  type FilterFieldBuildValue,
  type FilterOption,
  type FilterRangeValue,
} from '../../common/filter-scheme';

const CUSTOMER_PAGE_KEY = 'crm.customers';

const INDUSTRY_SET = new Set<string>(INDUSTRY_VALUES);
const RECORD_STATUS_SET = new Set<string>(Object.keys(RECORD_STATUS_LABELS));
const CUSTOMER_LEVEL_SET = new Set<string>(Object.keys(CUSTOMER_LEVEL_LABELS));
const CUSTOMER_SOURCE_SET = new Set<string>(Object.keys(CUSTOMER_SOURCE_LABELS));
const CONTACT_STATUS_SET = new Set<string>(Object.keys(CONTACT_STATUS_LABELS));
const DEAL_STATUS_SET = new Set<string>(Object.keys(DEAL_STATUS_LABELS));
const LEAD_STAGE_SET = new Set<string>(Object.keys(LEAD_STAGE_LABELS));
const LEAD_PROGRESS_STATUS_SET = new Set<string>(Object.keys(LEAD_PROGRESS_STATUS_LABELS));
const CUSTOMER_RELATIONSHIP_SET = new Set<string>(Object.keys(CUSTOMER_RELATIONSHIP_LABELS));
const INTENT_TEMPERATURE_SET = new Set<string>(Object.keys(INTENT_TEMPERATURE_LABELS));
const LEAD_VALIDITY_SET = new Set<string>(Object.keys(LEAD_VALIDITY_LABELS));

export const CUSTOMER_FILTER_REGISTRY = defineFilterRegistry({
  pageKey: CUSTOMER_PAGE_KEY,
  pageName: '客户列表',
  fields: {
    status: {
      label: '状态',
      dataType: 'enum',
      allowedControls: ['select', 'multiSelect'],
      optionsSource: () => toOptions(RECORD_STATUS_LABELS),
      build: (value) => buildEnumFilter('status', RECORD_STATUS_SET, value),
    },
    customerLevel: {
      label: '客户等级',
      dataType: 'enum',
      allowedControls: ['select', 'multiSelect'],
      optionsSource: () => toOptions(CUSTOMER_LEVEL_LABELS),
      build: (value) => buildEnumFilter('customerLevel', CUSTOMER_LEVEL_SET, value),
    },
    customerSource: {
      label: '客户来源',
      dataType: 'enum',
      allowedControls: ['select', 'multiSelect'],
      optionsSource: () => toOptions(CUSTOMER_SOURCE_LABELS),
      build: (value) => buildEnumFilter('customerSource', CUSTOMER_SOURCE_SET, value),
    },
    contactStatus: {
      label: '跟进状态',
      dataType: 'enum',
      allowedControls: ['select', 'multiSelect'],
      optionsSource: () => toOptions(CONTACT_STATUS_LABELS),
      build: (value) => buildEnumFilter('contactStatus', CONTACT_STATUS_SET, value),
    },
    dealStatus: {
      label: '成交状态',
      dataType: 'enum',
      allowedControls: ['select', 'multiSelect'],
      optionsSource: () => toOptions(DEAL_STATUS_LABELS),
      build: (value) => buildEnumFilter('dealStatus', DEAL_STATUS_SET, value),
    },
    leadStage: {
      label: '线索阶段',
      dataType: 'enum',
      allowedControls: ['select', 'multiSelect'],
      optionsSource: () => toOptions(LEAD_STAGE_LABELS),
      build: (value) => buildEnumFilter('leadStage', LEAD_STAGE_SET, value),
    },
    leadProgressStatus: {
      label: '推进状态',
      dataType: 'enum',
      allowedControls: ['select', 'multiSelect'],
      optionsSource: () => toOptions(LEAD_PROGRESS_STATUS_LABELS),
      build: (value) => buildEnumFilter('leadProgressStatus', LEAD_PROGRESS_STATUS_SET, value),
    },
    intentTemperature: {
      label: '意向温度',
      dataType: 'enum',
      allowedControls: ['select', 'multiSelect'],
      optionsSource: () => toOptions(INTENT_TEMPERATURE_LABELS),
      build: (value) => buildEnumFilter('intentTemperature', INTENT_TEMPERATURE_SET, value),
    },
    leadValidity: {
      label: '线索有效性',
      dataType: 'enum',
      allowedControls: ['select', 'multiSelect'],
      optionsSource: () => toOptions(LEAD_VALIDITY_LABELS),
      build: (value) => buildEnumFilter('leadValidity', LEAD_VALIDITY_SET, value),
    },
    nextFollowUpAt: {
      label: '下次回访日期',
      dataType: 'date',
      allowedControls: ['dateRange'],
      build: (value) => buildDateFilter('nextFollowUpAt', value),
    },
    industry: {
      label: '行业',
      dataType: 'enum',
      allowedControls: ['select', 'multiSelect'],
      optionsSource: () => toOptions(INDUSTRY_LABELS),
      build: (value) => buildEnumFilter('industry', INDUSTRY_SET, value),
    },
    customerRelationship: {
      label: '客户关系',
      dataType: 'enum',
      allowedControls: ['select', 'multiSelect'],
      optionsSource: () => toOptions(CUSTOMER_RELATIONSHIP_LABELS),
      build: (value) => buildEnumFilter('customerRelationship', CUSTOMER_RELATIONSHIP_SET, value),
    },
    chargerId: {
      label: '负责人',
      dataType: 'foreignKey',
      entity: 'employee',
      allowedControls: ['entitySelect', 'entityMultiSelect'],
      build: (value) => {
        const selected = toStringArray(value);
        if (!selected || selected.length === 0) {
          return null;
        }
        return {
          chargerId: {
            in: selected,
          },
        };
      },
    },
    hasContactPhone: {
      label: '是否有联系人电话',
      dataType: 'enum',
      allowedControls: ['select'],
      optionsSource: () => HAS_CONTACT_PHONE_OPTIONS.map((option): FilterOption => ({ ...option })),
      build: (value) => buildHasContactPhoneFilter(value),
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
    lastKeepRecordTime: {
      label: '最近跟进时间',
      dataType: 'date',
      allowedControls: ['date', 'dateRange'],
      build: buildLatestKeepRecordFilter,
    },
    customerName: {
      label: '客户名称',
      dataType: 'string',
      searchable: true,
      allowedControls: ['text'],
      build: (value) => buildStringFilter('customerName', value),
    },
    shortName: {
      label: '简称',
      dataType: 'string',
      searchable: true,
      allowedControls: ['text'],
      build: (value) => buildStringFilter('shortName', value),
    },
    chargerName: {
      label: '负责人姓名',
      dataType: 'string',
      searchable: true,
      allowedControls: ['text'],
      build: (value) =>
        buildStringFilterWithRelationFallback('chargerName', 'charger', 'name', value),
    },
    accountsReceivable: {
      label: '应收账款',
      dataType: 'decimal',
      allowedControls: ['numberEqual', 'numberRange'],
      build: (value) => buildNumberFilter('accountsReceivable', value),
    },
  },
  defaults: {
    fields: [
      { fieldKey: 'status', control: 'multiSelect' },
      { fieldKey: 'customerLevel', control: 'multiSelect' },
      { fieldKey: 'customerSource', control: 'multiSelect' },
      { fieldKey: 'contactStatus', control: 'multiSelect' },
      { fieldKey: 'hasContactPhone', control: 'select' },
      { fieldKey: 'dealStatus', control: 'multiSelect' },
      { fieldKey: 'intentTemperature', control: 'multiSelect' },
      { fieldKey: 'lastKeepRecordTime', control: 'dateRange' },
      { fieldKey: 'nextFollowUpAt', control: 'dateRange' },
      { fieldKey: 'leadStage', control: 'multiSelect' },
      { fieldKey: 'leadProgressStatus', control: 'multiSelect' },
      { fieldKey: 'chargerId', control: 'entitySelect' },
    ],
    keyword: {
      enabled: true,
      fieldKeys: ['customerName', 'shortName', 'chargerName'],
      placeholder: '客户名称/负责人',
    },
  },
});

function buildHasContactPhoneFilter(value: FilterFieldBuildValue): Record<string, unknown> | null {
  const selected = toStringArray(value)?.[0];
  if (selected !== 'yes' && selected !== 'no') {
    return null;
  }

  const contactWithPhone = {
    deletedAt: null,
    OR: [
      {
        AND: [{ mobile: { not: null } }, { mobile: { not: '' } }],
      },
      {
        AND: [{ phone: { not: null } }, { phone: { not: '' } }],
      },
    ],
  };

  return {
    contacts: selected === 'yes' ? { some: contactWithPhone } : { none: contactWithPhone },
  };
}

function toOptions(labels: Record<string, string>): FilterOption[] {
  return Object.entries(labels).map(([value, label]) => ({
    value,
    label,
  }));
}

function buildEnumFilter(
  fieldKey: string,
  allowedValues: Set<string>,
  value: FilterFieldBuildValue
): Record<string, unknown> | null {
  const selected = toStringArray(value)?.filter((item) => allowedValues.has(item));
  if (!selected || selected.length === 0) {
    return null;
  }
  return {
    [fieldKey]: {
      in: selected,
    },
  };
}

function buildStringFilter(
  fieldKey: string,
  value: FilterFieldBuildValue
): Record<string, unknown> | null {
  if (typeof value !== 'string' || value.length === 0) {
    return null;
  }
  return {
    [fieldKey]: {
      contains: escapeLikeChars(value),
      mode: 'insensitive',
    },
  };
}

function buildLatestKeepRecordFilter(value: FilterFieldBuildValue): Record<string, unknown> | null {
  const dateFilter = buildDateFilter('keepRecordTime', value);
  const keepRecordTime = dateFilter?.keepRecordTime;
  if (!isDateCondition(keepRecordTime)) {
    return null;
  }

  const baseWhere = {
    deletedAt: null,
    AND: [
      {
        OR: [{ flowStatus: APPROVAL_INSTANCE_STATUS.APPROVED }, { flowStatus: null }],
      },
      {
        OR: [{ source: null }, { source: { not: KEEP_RECORD_SOURCE.FIELD_CHANGE } }],
      },
    ],
  };
  const some = { ...baseWhere, keepRecordTime };
  const endTime = keepRecordTime['lt'];

  // “最近跟进”取最后一条有效跟进记录，而不是任意一条命中的历史记录。
  // 有结束边界时排除结束日后的跟进，确保结果与客户详情展示一致。
  if (!(endTime instanceof Date)) {
    return { keepRecords: { some } };
  }

  return {
    keepRecords: {
      some,
      none: {
        ...baseWhere,
        keepRecordTime: { gte: endTime },
      },
    },
  };
}

function buildNumberFilter(
  fieldKey: string,
  value: FilterFieldBuildValue
): Record<string, unknown> | null {
  if (typeof value === 'number') {
    return {
      [fieldKey]: value,
    };
  }

  if (!isRangeValue(value)) {
    return null;
  }

  const condition: Record<string, number> = {};
  if (value.min !== undefined) {
    condition.gte = value.min;
  }
  if (value.max !== undefined) {
    condition.lte = value.max;
  }

  return Object.keys(condition).length > 0
    ? {
        [fieldKey]: condition,
      }
    : null;
}

function toStringArray(value: FilterFieldBuildValue): string[] | undefined {
  if (typeof value === 'string') {
    return [value];
  }
  if (!Array.isArray(value)) {
    return undefined;
  }
  return value.filter((item): item is string => typeof item === 'string');
}

function isRangeValue(value: FilterFieldBuildValue): value is FilterRangeValue {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isDateCondition(value: unknown): value is Record<string, Date> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.values(value).every((item) => item instanceof Date)
  );
}
