import { APPROVAL_INSTANCE_STATUS, KEEP_RECORD_SOURCE } from '@ky-azeroth/shared/constants';
import { queryCustomerSchema } from '@ky-azeroth/shared/schemas/customer';
import type { FilterSchemeConfig } from '@ky-azeroth/shared/schemas/filter-scheme';
import { describe, expect, it, vi } from 'vitest';

import { FilterApplierService } from '../../../common/filter-scheme';
import type { FilterSchemesService } from '../../filter-schemes/filter-schemes.service';
import { CUSTOMER_FILTER_REGISTRY } from '../customers.filter-registry';

const CONTACT_WITH_PHONE_CONDITION = {
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

describe('CUSTOMER_FILTER_REGISTRY', () => {
  it('应注册是否有联系人电话筛选项并提供默认下拉配置', () => {
    const field = CUSTOMER_FILTER_REGISTRY.fields.hasContactPhone;

    expect(field.label).toBe('是否有联系人电话');
    expect(field.dataType).toBe('enum');
    expect(field.allowedControls).toEqual(['select']);
    expect(field.optionsSource?.()).toEqual([
      { value: 'yes', label: '有' },
      { value: 'no', label: '无' },
    ]);
    expect(CUSTOMER_FILTER_REGISTRY.defaults.fields).toContainEqual({
      fieldKey: 'hasContactPhone',
      control: 'select',
    });
  });

  it('默认筛选第二行应按成交与回访业务顺序排列', () => {
    expect(CUSTOMER_FILTER_REGISTRY.defaults.fields.slice(4, 9)).toEqual([
      { fieldKey: 'hasContactPhone', control: 'select' },
      { fieldKey: 'dealStatus', control: 'multiSelect' },
      { fieldKey: 'intentTemperature', control: 'multiSelect' },
      { fieldKey: 'lastKeepRecordTime', control: 'dateRange' },
      { fieldKey: 'nextFollowUpAt', control: 'dateRange' },
    ]);
  });

  it('客户来源筛选项包含小红书、抖音、视频号', () => {
    const options = CUSTOMER_FILTER_REGISTRY.fields.customerSource.optionsSource?.() ?? [];
    expect(options).toEqual(
      expect.arrayContaining([
        { value: '小红书', label: '小红书' },
        { value: '抖音', label: '抖音' },
        { value: '视频号', label: '视频号' },
      ])
    );
    expect(
      CUSTOMER_FILTER_REGISTRY.fields.customerSource.build(['小红书', '抖音', '视频号'])
    ).toEqual({
      customerSource: { in: ['小红书', '抖音', '视频号'] },
    });
  });

  it('意向温度与线索有效性筛选项显示中文且保留原始枚举值', () => {
    expect(CUSTOMER_FILTER_REGISTRY.fields.intentTemperature.optionsSource?.()).toEqual([
      { value: 'UNJUDGED', label: '未判断' },
      { value: 'HIGH', label: '高意向' },
      { value: 'MEDIUM', label: '中意向' },
      { value: 'LOW', label: '低意向' },
      { value: 'NONE', label: '无意向' },
    ]);
    expect(CUSTOMER_FILTER_REGISTRY.fields.leadValidity.optionsSource?.()).toEqual([
      { value: 'VALID', label: '有效' },
      { value: 'INVALID', label: '无效' },
    ]);
  });

  it('选择有联系人电话时应筛选存在未删除且 mobile 或 phone 非空的联系人客户', () => {
    expect(CUSTOMER_FILTER_REGISTRY.fields.hasContactPhone.build(['yes'])).toEqual({
      contacts: {
        some: CONTACT_WITH_PHONE_CONDITION,
      },
    });
  });

  it('选择无联系人电话时应筛选不存在未删除且 mobile 或 phone 非空联系人的客户', () => {
    expect(CUSTOMER_FILTER_REGISTRY.fields.hasContactPhone.build(['no'])).toEqual({
      contacts: {
        none: CONTACT_WITH_PHONE_CONDITION,
      },
    });
  });

  it('非法值不应生成联系人电话筛选条件', () => {
    expect(CUSTOMER_FILTER_REGISTRY.fields.hasContactPhone.build('unknown')).toBeNull();
  });

  it('应通过 FilterApplier 真实归一化链路生成联系人电话 legacy 筛选条件', async () => {
    const service = createFilterApplierService();

    const where = await service.buildWhere({
      registry: CUSTOMER_FILTER_REGISTRY,
      rawQuery: undefined,
      legacyFilters: { hasContactPhone: 'yes' },
      chargerScope: null,
      baseWhere: { deletedAt: null },
    });

    expect(where).toEqual({
      deletedAt: null,
      AND: [
        {
          contacts: {
            some: CONTACT_WITH_PHONE_CONDITION,
          },
        },
      ],
    });
  });

  it('应通过 FilterApplier 真实归一化链路生成联系人电话 raw 筛选条件', async () => {
    const service = createFilterApplierService();

    const where = await service.buildWhere({
      registry: CUSTOMER_FILTER_REGISTRY,
      rawQuery: { 'filters[hasContactPhone]': 'no' },
      chargerScope: null,
      baseWhere: { deletedAt: null },
    });

    expect(where).toEqual({
      deletedAt: null,
      AND: [
        {
          contacts: {
            none: CONTACT_WITH_PHONE_CONDITION,
          },
        },
      ],
    });
  });

  it('客户查询 Schema 应允许空联系人电话筛选值按未提供处理', () => {
    const result = queryCustomerSchema.safeParse({
      page: 1,
      pageSize: 10,
      hasContactPhone: '',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.hasContactPhone).toBeUndefined();
    }
  });

  it('客户查询 Schema 应拒绝非法联系人电话筛选值', () => {
    expect(
      queryCustomerSchema.safeParse({
        page: 1,
        pageSize: 10,
        hasContactPhone: 'unknown',
      }).success
    ).toBe(false);
  });
  it('应按最后一条有效跟进记录筛选完整日期区间', () => {
    const field = CUSTOMER_FILTER_REGISTRY.fields.lastKeepRecordTime;
    const start = new Date('2026-07-31T16:00:00.000Z');
    const end = new Date('2026-08-31T16:00:00.000Z');

    expect(field.label).toBe('最近跟进时间');
    expect(field.dataType).toBe('date');
    expect(field.allowedControls).toEqual(['date', 'dateRange']);
    expect(field.build({})).toBeNull();
    expect(field.build({ from: '2026-08-01', to: '2026-08-31' })).toEqual({
      keepRecords: {
        some: buildEffectiveKeepRecordWhere({ gte: start, lt: end }),
        none: buildEffectiveKeepRecordWhere({ gte: end }),
      },
    });
  });

  it('全员方案未启用时，个人配置提交的最近跟进时间仍应生效', async () => {
    const service = createFilterApplierService(CUSTOMER_FILTER_REGISTRY.defaults);
    const start = new Date('2026-07-31T16:00:00.000Z');
    const end = new Date('2026-08-31T16:00:00.000Z');

    const where = await service.buildWhere({
      registry: CUSTOMER_FILTER_REGISTRY,
      rawQuery: {
        'filters[lastKeepRecordTime][from]': '2026-08-01',
        'filters[lastKeepRecordTime][to]': '2026-08-31',
      },
      chargerScope: null,
      baseWhere: { deletedAt: null },
    });

    expect(where).toEqual({
      deletedAt: null,
      AND: [
        {
          keepRecords: {
            some: buildEffectiveKeepRecordWhere({ gte: start, lt: end }),
            none: buildEffectiveKeepRecordWhere({ gte: end }),
          },
        },
      ],
    });
  });

  it('最近跟进时间仅选择开始日时应保留开始日及之后的最后跟进记录', () => {
    const field = CUSTOMER_FILTER_REGISTRY.fields.lastKeepRecordTime;

    expect(field.build({ from: '2026-08-01' })).toEqual({
      keepRecords: {
        some: buildEffectiveKeepRecordWhere({
          gte: new Date('2026-07-31T16:00:00.000Z'),
        }),
      },
    });
  });

  it('最近跟进时间仅选择结束日时应排除结束日后的跟进记录', () => {
    const field = CUSTOMER_FILTER_REGISTRY.fields.lastKeepRecordTime;
    const end = new Date('2026-08-31T16:00:00.000Z');

    expect(field.build({ to: '2026-08-31' })).toEqual({
      keepRecords: {
        some: buildEffectiveKeepRecordWhere({ lt: end }),
        none: buildEffectiveKeepRecordWhere({ gte: end }),
      },
    });
  });
});

function buildEffectiveKeepRecordWhere(keepRecordTime: Record<string, Date>) {
  return {
    deletedAt: null,
    keepRecordTime,
    AND: [
      {
        OR: [{ flowStatus: APPROVAL_INSTANCE_STATUS.APPROVED }, { flowStatus: null }],
      },
      {
        OR: [{ source: null }, { source: { not: KEEP_RECORD_SOURCE.FIELD_CHANGE } }],
      },
    ],
  };
}

function createFilterApplierService(
  activeConfig: FilterSchemeConfig = CUSTOMER_FILTER_REGISTRY.defaults
): FilterApplierService {
  const schemesService = {
    getActive: vi.fn().mockResolvedValue({
      config: activeConfig,
      version: 1,
    }),
  };

  return new FilterApplierService(schemesService as unknown as FilterSchemesService);
}
