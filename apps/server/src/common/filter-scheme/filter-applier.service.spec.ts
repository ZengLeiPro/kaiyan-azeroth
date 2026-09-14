import type { FilterSchemeConfig } from '@ky-azeroth/shared/schemas/filter-scheme';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { FilterSchemesService } from '../../modules/filter-schemes/filter-schemes.service';
import { FilterApplierService } from './filter-applier.service';
import { buildDateFilter, defineFilterRegistry, escapeLikeChars } from './index';

const TEST_REGISTRY = defineFilterRegistry({
  pageKey: 'test.filters',
  pageName: '测试列表',
  fields: {
    enumField: {
      label: '枚举字段',
      dataType: 'enum',
      allowedControls: ['multiSelect'],
      build: (value) =>
        Array.isArray(value) && value.length > 0 ? { enumField: { in: value } } : null,
    },
    stringField: {
      label: '字符串字段',
      dataType: 'string',
      searchable: true,
      allowedControls: ['text'],
      build: (value) =>
        typeof value === 'string'
          ? {
              stringField: {
                contains: escapeLikeChars(value),
                mode: 'insensitive',
              },
            }
          : null,
    },
    hiddenStringField: {
      label: '隐藏字符串字段',
      dataType: 'string',
      searchable: false,
      allowedControls: ['text'],
      build: (value) =>
        typeof value === 'string'
          ? {
              hiddenStringField: {
                contains: escapeLikeChars(value),
                mode: 'insensitive',
              },
            }
          : null,
    },
    relationStringField: {
      label: '关联字符串字段',
      dataType: 'string',
      searchable: true,
      allowedControls: ['text'],
      build: (value) =>
        typeof value === 'string'
          ? {
              OR: [
                {
                  relationStringField: {
                    contains: escapeLikeChars(value),
                    mode: 'insensitive',
                  },
                },
                {
                  relation: {
                    name: {
                      contains: escapeLikeChars(value),
                      mode: 'insensitive',
                    },
                  },
                },
              ],
            }
          : null,
    },
    dateField: {
      label: '日期字段',
      dataType: 'date',
      allowedControls: ['dateRange'],
      build: (value) => buildDateFilter('dateField', value),
    },
    chargerId: {
      label: '负责人',
      dataType: 'foreignKey',
      allowedControls: ['entitySelect', 'entityMultiSelect'],
      isScopeField: true,
      build: (value) =>
        Array.isArray(value) && value.length > 0 ? { chargerId: { in: value } } : null,
    },
    decimalField: {
      label: '小数字段',
      dataType: 'decimal',
      allowedControls: ['numberRange', 'numberEqual'],
      build: (value) => buildNumberField('decimalField', value),
    },
    intField: {
      label: '整数字段',
      dataType: 'int',
      allowedControls: ['numberRange', 'numberEqual'],
      build: (value) => buildNumberField('intField', value),
    },
    booleanField: {
      label: '布尔字段',
      dataType: 'boolean',
      allowedControls: ['switch'],
      build: (value) => (typeof value === 'boolean' ? { booleanField: value } : null),
    },
  },
  defaults: {
    fields: [
      { fieldKey: 'enumField', control: 'multiSelect' },
      { fieldKey: 'stringField', control: 'text' },
      { fieldKey: 'dateField', control: 'dateRange' },
      { fieldKey: 'chargerId', control: 'entitySelect' },
      { fieldKey: 'decimalField', control: 'numberRange' },
      { fieldKey: 'intField', control: 'numberRange' },
      { fieldKey: 'booleanField', control: 'switch' },
    ],
    keyword: {
      enabled: true,
      fieldKeys: ['stringField', 'hiddenStringField'],
      placeholder: '搜索字符串字段',
    },
  },
});

describe('FilterApplierService', () => {
  let service: FilterApplierService;
  let mockSchemesService: {
    getActive: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    mockSchemesService = {
      getActive: vi.fn().mockResolvedValue({
        config: cloneConfig(TEST_REGISTRY.defaults),
        version: 1,
      }),
    };
    service = new FilterApplierService(mockSchemesService as unknown as FilterSchemesService);
  });

  it('应覆盖 enum/string/date/foreignKey/decimal/int/boolean 的正常分支', async () => {
    const where = await service.buildWhere({
      registry: TEST_REGISTRY,
      rawQuery: {
        keyword: 'A_B%',
        filters: {
          enumField: ['A', 'B'],
          stringField: 'Alice_%',
          dateField: { from: '2026-02-03', to: '2026-02-05' },
          chargerId: ['emp-1', 'emp-2'],
          decimalField: { min: '10.5', max: '88.8' },
          intField: '7',
          booleanField: 'true',
        },
      },
      chargerScope: null,
      baseWhere: { deletedAt: null },
    });

    expect(where).toEqual({
      deletedAt: null,
      AND: [
        {
          OR: [
            {
              stringField: {
                contains: 'A\\_B\\%',
                mode: 'insensitive',
              },
            },
          ],
        },
        { enumField: { in: ['A', 'B'] } },
        {
          stringField: {
            contains: 'Alice\\_\\%',
            mode: 'insensitive',
          },
        },
        {
          dateField: {
            gte: beijingMidnight('2026-02-03'),
            lt: addDays(beijingMidnight('2026-02-05'), 1),
          },
        },
        { chargerId: { in: ['emp-1', 'emp-2'] } },
        { decimalField: { gte: 10.5, lte: 88.8 } },
        { intField: 7 },
        { booleanField: true },
      ],
    });
  });

  it('应覆盖各 dataType 的非法与空值分支并静默丢弃', async () => {
    const where = await service.buildWhere({
      registry: TEST_REGISTRY,
      rawQuery: {
        filters: {
          enumField: { bad: true },
          stringField: '',
          dateField: { from: '', to: '' },
          chargerId: 123,
          decimalField: 'abc',
          intField: '3.14',
          booleanField: 'not-bool',
        },
      },
      chargerScope: null,
      baseWhere: { deletedAt: null },
    });

    expect(where).toEqual({ deletedAt: null });
  });

  it('应丢弃 __proto__、password 和 registry 未声明字段', async () => {
    const where = await service.buildWhere({
      registry: TEST_REGISTRY,
      rawQuery: {
        'filters.__proto__': 'polluted',
        'filters.password': 'secret',
        filters: {
          unknownField: 'oops',
        },
      },
      chargerScope: null,
      baseWhere: { deletedAt: null },
    });

    expect(where).toEqual({ deletedAt: null });
  });

  it('应对 DataScope 做交集并将 scope 条件最后注入', async () => {
    const where = await service.buildWhere({
      registry: TEST_REGISTRY,
      rawQuery: {
        filters: {
          chargerId: ['other-emp', 'self-emp'],
        },
      },
      chargerScope: ['self-emp', 'team-emp'],
      baseWhere: { deletedAt: null },
    });

    expect(where).toEqual({
      deletedAt: null,
      AND: [{ chargerId: { in: ['self-emp'] } }],
    });
  });

  it('应在 keyword.fieldKeys 为空时跳过 OR 条件', async () => {
    mockSchemesService.getActive.mockResolvedValue({
      config: {
        ...cloneConfig(TEST_REGISTRY.defaults),
        keyword: {
          enabled: true,
          fieldKeys: [],
          placeholder: null,
        },
      } satisfies FilterSchemeConfig,
      version: 1,
    });

    const where = await service.buildWhere({
      registry: TEST_REGISTRY,
      rawQuery: { keyword: 'Acme' },
      chargerScope: null,
      baseWhere: { deletedAt: null },
    });

    expect(where).toEqual({ deletedAt: null });
  });

  it('应过滤掉非 searchable 字段，只为合法字符串字段生成 keyword OR', async () => {
    const where = await service.buildWhere({
      registry: TEST_REGISTRY,
      rawQuery: { keyword: '负责人' },
      chargerScope: null,
      baseWhere: { deletedAt: null },
    });

    expect(where).toEqual({
      deletedAt: null,
      AND: [
        {
          OR: [
            {
              stringField: {
                contains: '负责人',
                mode: 'insensitive',
              },
            },
          ],
        },
      ],
    });
  });

  it('keyword 应复用 registry 字段 build 结果，支持关联字段兜底', async () => {
    mockSchemesService.getActive.mockResolvedValue({
      config: {
        ...cloneConfig(TEST_REGISTRY.defaults),
        keyword: {
          enabled: true,
          fieldKeys: ['relationStringField'],
          placeholder: null,
        },
      } satisfies FilterSchemeConfig,
      version: 1,
    });

    const where = await service.buildWhere({
      registry: TEST_REGISTRY,
      rawQuery: { keyword: '张_%' },
      chargerScope: null,
      baseWhere: { deletedAt: null },
    });

    expect(where).toEqual({
      deletedAt: null,
      AND: [
        {
          OR: [
            {
              OR: [
                {
                  relationStringField: {
                    contains: '张\\_\\%',
                    mode: 'insensitive',
                  },
                },
                {
                  relation: {
                    name: {
                      contains: '张\\_\\%',
                      mode: 'insensitive',
                    },
                  },
                },
              ],
            },
          ],
        },
      ],
    });
  });

  it('legacyFilters 中的字段即使未激活也应生效（service 内部硬过滤不受用户方案影响）', async () => {
    const where = await service.buildWhere({
      registry: TEST_REGISTRY,
      rawQuery: {},
      legacyFilters: {
        hiddenStringField: 'leo',
      },
      chargerScope: null,
      baseWhere: { deletedAt: null },
    });

    expect(where).toEqual({
      deletedAt: null,
      AND: [
        {
          hiddenStringField: {
            contains: 'leo',
            mode: 'insensitive',
          },
        },
      ],
    });
  });

  it('rawQuery 中全员方案未激活但 registry 已声明的字段仍应生效', async () => {
    const where = await service.buildWhere({
      registry: TEST_REGISTRY,
      rawQuery: {
        filters: {
          hiddenStringField: 'leo',
        },
      },
      chargerScope: null,
      baseWhere: { deletedAt: null },
    });

    expect(where).toEqual({
      deletedAt: null,
      AND: [
        {
          hiddenStringField: {
            contains: 'leo',
            mode: 'insensitive',
          },
        },
      ],
    });
  });

  it('legacyFilters 与 rawQuery 同名字段时 rawQuery 应优先', async () => {
    const where = await service.buildWhere({
      registry: TEST_REGISTRY,
      rawQuery: {
        filters: {
          stringField: 'from-raw',
        },
      },
      legacyFilters: {
        stringField: 'from-legacy',
      },
      chargerScope: null,
      baseWhere: { deletedAt: null },
    });

    expect(where).toEqual({
      deletedAt: null,
      AND: [
        {
          stringField: {
            contains: 'from-raw',
            mode: 'insensitive',
          },
        },
      ],
    });
  });

  it('legacyFilters 中 registry 未声明的字段仍应被丢弃（不可绕过 registry 校验）', async () => {
    const where = await service.buildWhere({
      registry: TEST_REGISTRY,
      rawQuery: {},
      legacyFilters: {
        unknownField: 'oops',
        __proto__: 'polluted',
      },
      chargerScope: null,
      baseWhere: { deletedAt: null },
    });

    expect(where).toEqual({ deletedAt: null });
  });

  it('应支持 bracket filters 并使用 [gte, lt) 日期边界', async () => {
    const where = await service.buildWhere({
      registry: TEST_REGISTRY,
      rawQuery: {
        'filters[dateField][from]': '2026-03-08',
        'filters[dateField][to]': '2026-03-08',
      },
      chargerScope: null,
      baseWhere: { deletedAt: null },
    });

    expect(where).toEqual({
      deletedAt: null,
      AND: [
        {
          dateField: {
            gte: beijingMidnight('2026-03-08'),
            lt: addDays(beijingMidnight('2026-03-08'), 1),
          },
        },
      ],
    });
  });

  it('date-only 字符串应按北京时间(UTC+8)解析为零点，而非 UTC 零点', async () => {
    const where = await service.buildWhere({
      registry: TEST_REGISTRY,
      rawQuery: {
        'filters[dateField][from]': '2026-07-01',
        'filters[dateField][to]': '2026-07-31',
      },
      chargerScope: null,
      baseWhere: { deletedAt: null },
    });

    // Beijing midnight 2026-07-01 = UTC 2026-06-30T16:00:00Z
    // Beijing midnight 2026-08-01 = UTC 2026-07-31T16:00:00Z
    expect(where).toEqual({
      deletedAt: null,
      AND: [
        {
          dateField: {
            gte: new Date('2026-06-30T16:00:00.000Z'),
            lt: new Date('2026-07-31T16:00:00.000Z'),
          },
        },
      ],
    });
  });
});

function buildNumberField(fieldKey: string, value: unknown) {
  if (typeof value === 'number') {
    return { [fieldKey]: value };
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
  return Object.keys(condition).length > 0 ? { [fieldKey]: condition } : null;
}

function isRangeValue(value: unknown): value is { min?: number; max?: number } {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function cloneConfig(config: FilterSchemeConfig): FilterSchemeConfig {
  return structuredClone(config);
}

function beijingMidnight(dateStr: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
  return new Date(Date.UTC(+m![1]!, +m![2]! - 1, +m![3]!) - 8 * 60 * 60 * 1000);
}

function addDays(value: Date, days: number): Date {
  const result = new Date(value);
  result.setDate(result.getDate() + days);
  return result;
}
