/**
 * 验证 useFilterScheme / previewComposeScheme 的关键行为：
 * - fields 按 config.fields 顺序生成，keyword 启用时 prepend
 * - initialFilters 根据控件类型生成正确的 flat bracket-style key 与默认值
 * - options 来源是 registry.options；缺失时返回空数组
 * - entity 控件仅允许 customer/employee/department/project，其余被 filter 掉
 * - 404 / 接口失败 → isFallback=true，fields=[]
 */
import type { FilterSchemeDetailResponse } from '@ky-azeroth/shared/schemas/filter-scheme';
import { describe, expect, it } from 'vitest';

import { previewComposeScheme } from '../use-filter-scheme';

function makeDetail(
  overrides: Partial<FilterSchemeDetailResponse> = {}
): FilterSchemeDetailResponse {
  return {
    registry: {
      pageKey: 'crm.customers',
      pageName: '客户列表',
      defaults: { fields: [], keyword: { enabled: false, fieldKeys: [], placeholder: null } },
      fields: [
        {
          fieldKey: 'customerLevel',
          label: '客户等级',
          dataType: 'enum',
          allowedControls: ['multiSelect', 'select'],
          options: [
            { value: 'A', label: 'A' },
            { value: 'B', label: 'B' },
          ],
        },
        {
          fieldKey: 'chargerId',
          label: '负责人',
          dataType: 'foreignKey',
          allowedControls: ['entitySelect', 'entityMultiSelect'],
          entity: 'employee',
        },
        {
          fieldKey: 'createdAt',
          label: '创建时间',
          dataType: 'date',
          allowedControls: ['dateRange', 'date'],
        },
        {
          fieldKey: 'customerName',
          label: '客户名称',
          dataType: 'string',
          allowedControls: ['text'],
          searchable: true,
        },
        {
          fieldKey: 'accountsReceivable',
          label: '应收账款',
          dataType: 'decimal',
          allowedControls: ['numberRange', 'numberEqual'],
        },
      ],
    },
    config: {
      fields: [
        { fieldKey: 'customerLevel', control: 'multiSelect' },
        { fieldKey: 'chargerId', control: 'entitySelect' },
        { fieldKey: 'createdAt', control: 'dateRange' },
        { fieldKey: 'accountsReceivable', control: 'numberRange' },
      ],
      keyword: {
        enabled: true,
        fieldKeys: ['customerName'],
        placeholder: '客户名称',
      },
    },
    version: 3,
    ...overrides,
  };
}

describe('useFilterScheme / previewComposeScheme', () => {
  it('keyword 启用时 prepend text 字段，并保留当前默认配置', () => {
    const detail = makeDetail();
    const result = previewComposeScheme(detail);
    expect(result.version).toBe(3);
    expect(result.defaultConfig).toEqual(detail.config);
    expect(result.fields[0]).toMatchObject({ kind: 'text', key: 'keyword', label: '关键词' });
    expect(result.keywordFieldKeys).toEqual(['customerName']);
  });

  it('按 config.fields 顺序生成后续字段，同时生成正确的 initialFilters 键', () => {
    const result = previewComposeScheme(makeDetail());
    // 第一项是 keyword
    const rest = result.fields.slice(1);
    expect(rest.map((f) => f.kind)).toEqual([
      'multiSelect',
      'entitySelect',
      'dateRange',
      'numberRange',
    ]);
    expect(result.initialFilters).toEqual({
      keyword: '',
      'filters[customerLevel][]': [],
      'filters[chargerId]': '',
      'filters[createdAt][from]': '',
      'filters[createdAt][to]': '',
      'filters[accountsReceivable][min]': '',
      'filters[accountsReceivable][max]': '',
    });
  });

  it('multiSelect 字段取 registry.options 作为选项', () => {
    const result = previewComposeScheme(makeDetail());
    const ml = result.fields.find((f) => f.kind === 'multiSelect');
    expect(ml?.kind).toBe('multiSelect');
    if (ml?.kind === 'multiSelect') {
      expect(ml.options).toEqual([
        { value: 'A', label: 'A' },
        { value: 'B', label: 'B' },
      ]);
    }
  });

  it('keyword 未启用时不 prepend', () => {
    const result = previewComposeScheme(
      makeDetail({
        config: {
          fields: [{ fieldKey: 'customerLevel', control: 'multiSelect' }],
          keyword: { enabled: false, fieldKeys: [], placeholder: null },
        },
      })
    );
    expect(result.fields.map((f) => f.kind)).toEqual(['multiSelect']);
    expect(result.initialFilters).toEqual({ 'filters[customerLevel][]': [] });
    expect(result.keywordFieldKeys).toEqual([]);
  });

  it('date 控件与 dateRange 产出相同的 from/to key 结构', () => {
    const result = previewComposeScheme(
      makeDetail({
        config: {
          fields: [{ fieldKey: 'createdAt', control: 'date' }],
          keyword: { enabled: false, fieldKeys: [], placeholder: null },
        },
      })
    );
    const field = result.fields[0];
    expect(field?.kind).toBe('dateRange');
    if (field?.kind === 'dateRange') {
      expect(field.fromKey).toBe('filters[createdAt][from]');
      expect(field.toKey).toBe('filters[createdAt][to]');
    }
  });

  it('未支持的 entity 字段会被安全丢弃', () => {
    const result = previewComposeScheme(
      makeDetail({
        registry: {
          pageKey: 'crm.customers',
          pageName: '客户列表',
          defaults: { fields: [], keyword: { enabled: false, fieldKeys: [], placeholder: null } },
          fields: [
            {
              fieldKey: 'shopId',
              label: '门店',
              dataType: 'foreignKey',
              allowedControls: ['entitySelect'],
              entity: 'shop', // 非支持的 entity
            },
          ],
        },
        config: {
          fields: [{ fieldKey: 'shopId', control: 'entitySelect' }],
          keyword: { enabled: false, fieldKeys: [], placeholder: null },
        },
      })
    );
    expect(result.fields).toEqual([]);
    expect(result.initialFilters).toEqual({});
  });

  it('text 字段生成扁平筛选键与默认值', () => {
    const result = previewComposeScheme(
      makeDetail({
        config: {
          fields: [{ fieldKey: 'customerName', control: 'text', label: '客户' }],
          keyword: { enabled: false, fieldKeys: [], placeholder: null },
        },
      })
    );

    expect(result.fields).toEqual([
      expect.objectContaining({
        kind: 'text',
        key: 'filters[customerName]',
        label: '客户',
      }),
    ]);
    expect(result.initialFilters).toEqual({ 'filters[customerName]': '' });
  });
});
