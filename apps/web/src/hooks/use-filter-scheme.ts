import type {
  FilterFieldItem,
  FilterRegistryFieldMeta,
  FilterRegistryMeta,
  FilterSchemeConfig,
  FilterSchemeDetailResponse,
} from '@ky-azeroth/shared/schemas/filter-scheme';
import type { PersonalFilterPreferenceResponse } from '@ky-azeroth/shared/schemas/personal-filter-scheme';
import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

import type {
  FilterEntity,
  FilterFieldConfig,
  FilterOption,
} from '@/components/patterns/crud-filter-bar';
import type { FilterValue } from '@/hooks/use-manual-filter';
import { api } from '@/lib/api';

const SUPPORTED_ENTITIES: readonly FilterEntity[] = [
  'customer',
  'employee',
  'department',
  'project',
] as const;

const KEYWORD_FIELD_KEY = 'keyword';

export interface FilterSchemeResult {
  /** 已合成的 CrudFilterBar 字段配置，按服务端顺序；keyword 字段（若启用）固定 prepend */
  fields: FilterFieldConfig<Record<string, FilterValue>>[];
  /** 与 fields 结构对应的初始值，用于 useManualFilter(initialFilters, transformParams, version) */
  initialFilters: Record<string, FilterValue>;
  /** 服务端声明为 searchable 的 keyword 字段 key 列表（可能为空，即未启用关键词搜索） */
  keywordFieldKeys: string[];
  /** 服务端 scheme 版本号。useManualFilter 依赖此版本号来决定何时 reset 而非 initialFilters 引用 */
  version: number;
  /** 正在拉取配置 */
  isLoading: boolean;
  /** 取失败或未注册时走兜底：fields=[], version=0 */
  isFallback: boolean;
  /** 服务端 registry 元数据（配置页/预览页可用），fallback 时为 null */
  registry: FilterRegistryMeta | null;
  /** 当前用户的展示配置；用于列表页个人化入口。 */
  config: FilterSchemeConfig | null;
  defaultConfig: FilterSchemeConfig | null;
}

/**
 * 从后端拉取 pageKey 对应的筛选方案，合成 CrudFilterBar 需要的 fields / initialFilters。
 *
 * 核心设计：
 * - 采用 "flat bracket-key state" 模式，避免嵌套对象导致 axios 默认 paramsSerializer 生成
 *   `filters[customerLevel][0]=A` 这种 indexed bracket（后端无法解析）；
 *   统一用 `filters[customerLevel][]`、`filters[createdAt][from]` 等扁平 key 做 state key，
 *   这样 axios 直接产出后端期望的 `filters[customerLevel][]=A&filters[createdAt][from]=2026-01-01`。
 * - 关键词字段统一用 top-level `keyword`（不走 filters 前缀，和后端 `normalizeRawQuery` 对齐）。
 * - `version` 变化才 reset，引用变化不 reset（由 useManualFilter 负责）。
 *
 * 后端 registry / config 的元数据完全决定：
 * - 字段渲染成哪种控件（select/multiSelect/entitySelect/...）
 * - select 控件的 options 来源（registry.options 序列化好）
 * - 每个字段的 label（优先 config.label，其次 registry.label）
 */
export function useFilterScheme(pageKey: string): FilterSchemeResult {
  const { data, isLoading, isError } = useQuery<FilterSchemeDetailResponse>({
    queryKey: ['filter-scheme', pageKey],
    queryFn: async () => {
      const res = await api.get<FilterSchemeDetailResponse>(`/filter-schemes/${pageKey}`);
      return res.data;
    },
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });
  const { data: personalPreference } = useQuery<PersonalFilterPreferenceResponse | null>({
    queryKey: ['personal-filter-preference', pageKey],
    queryFn: async () => (await api.get(`/filter-schemes/${pageKey}/personal-preference`)).data,
    enabled: Boolean(data),
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });

  return useMemo<FilterSchemeResult>(() => {
    if (isError || !data) {
      return {
        fields: [],
        initialFilters: {},
        keywordFieldKeys: [],
        version: 0,
        isLoading,
        isFallback: !isLoading,
        registry: null,
        config: null,
        defaultConfig: null,
      };
    }

    return composeScheme(data, personalPreference?.config, personalPreference?.version);
  }, [data, isError, isLoading, personalPreference]);
}

function composeScheme(
  detail: FilterSchemeDetailResponse,
  personalConfig?: FilterSchemeConfig,
  personalVersion?: number
): FilterSchemeResult {
  const { registry } = detail;
  const config = personalConfig ?? detail.config;
  // 个人展示配置更新时也必须重置 filter state，避免已隐藏字段残留查询条件。
  const version =
    personalVersion === undefined ? detail.version : detail.version * 1_000_000 + personalVersion;
  const registryFieldMap = new Map<string, FilterRegistryFieldMeta>(
    registry.fields.map((field) => [field.fieldKey, field])
  );

  const fields: FilterFieldConfig<Record<string, FilterValue>>[] = [];
  const initialFilters: Record<string, FilterValue> = {};

  // 1. keyword 字段（若启用）prepend
  if (config.keyword.enabled && config.keyword.fieldKeys.length > 0) {
    fields.push({
      kind: 'text',
      key: KEYWORD_FIELD_KEY,
      label: '关键词',
      placeholder: config.keyword.placeholder ?? '搜索...',
      width: 'w-40',
    } as FilterFieldConfig<Record<string, FilterValue>>);
    initialFilters[KEYWORD_FIELD_KEY] = '';
  }

  // 2. 其余字段按 config.fields 顺序渲染
  for (const item of config.fields) {
    const meta = registryFieldMap.get(item.fieldKey);
    if (!meta) continue; // 服务端已 sanitize；这里只是双保险

    const composed = composeFieldConfig(item, meta, initialFilters);
    if (composed) {
      fields.push(composed);
    }
  }

  return {
    fields,
    initialFilters,
    keywordFieldKeys: config.keyword.enabled ? config.keyword.fieldKeys : [],
    version,
    isLoading: false,
    isFallback: false,
    registry,
    config,
    defaultConfig: detail.config,
  };
}

/**
 * 为单个字段合成 FilterFieldConfig，并同步写 initialFilters 的 key/value。
 * 生成的 key 采用 flat bracket 风格，保证 axios 默认序列化后直接命中后端 parser。
 */
function composeFieldConfig(
  item: FilterFieldItem,
  meta: FilterRegistryFieldMeta,
  initialFilters: Record<string, FilterValue>
): FilterFieldConfig<Record<string, FilterValue>> | null {
  const label = item.label ?? meta.label;
  const width = item.width;

  switch (item.control) {
    case 'text': {
      const key = buildFilterKey(item.fieldKey);
      initialFilters[key] = '';
      return {
        kind: 'text',
        key,
        label,
        width,
      } as FilterFieldConfig<Record<string, FilterValue>>;
    }
    case 'select': {
      const key = buildFilterKey(item.fieldKey);
      initialFilters[key] = '';
      return {
        kind: 'select',
        key,
        label,
        width,
        options: resolveOptions(meta),
        searchable: true,
      } as FilterFieldConfig<Record<string, FilterValue>>;
    }
    case 'multiSelect': {
      const key = buildFilterArrayKey(item.fieldKey);
      initialFilters[key] = [];
      return {
        kind: 'multiSelect',
        key,
        label,
        width,
        options: resolveOptions(meta),
        searchable: true,
      } as FilterFieldConfig<Record<string, FilterValue>>;
    }
    case 'entitySelect': {
      const entity = resolveEntity(meta.entity);
      if (!entity) return null;
      const key = buildFilterKey(item.fieldKey);
      initialFilters[key] = '';
      return {
        kind: 'entitySelect',
        key,
        label,
        width,
        entity,
      } as FilterFieldConfig<Record<string, FilterValue>>;
    }
    case 'entityMultiSelect': {
      const entity = resolveEntity(meta.entity);
      if (!entity) return null;
      const key = buildFilterArrayKey(item.fieldKey);
      initialFilters[key] = [];
      return {
        kind: 'entityMultiSelect',
        key,
        label,
        width,
        entity,
      } as FilterFieldConfig<Record<string, FilterValue>>;
    }
    case 'date': {
      // 日期单日控件：state 只记当前选择的那一天（YYYY-MM-DD 字符串）；
      // 后端 `filters[xxx][from]=YYYY-MM-DD&filters[xxx][to]=YYYY-MM-DD` 才能解析。
      // 这里我们同时写 fromKey/toKey 两个扁平 state key，并在一个 UI 控件里同步控制：
      // 由于 CrudFilterBar 的 date kind 只绑定单个 key，这里特殊处理为 dateRange 的等价写法。
      const fromKey = buildFilterNestedKey(item.fieldKey, 'from');
      const toKey = buildFilterNestedKey(item.fieldKey, 'to');
      initialFilters[fromKey] = '';
      initialFilters[toKey] = '';
      return {
        kind: 'dateRange',
        fromKey,
        toKey,
        label,
        width,
        showQuickOptions: false,
      } as FilterFieldConfig<Record<string, FilterValue>>;
    }
    case 'dateRange': {
      const fromKey = buildFilterNestedKey(item.fieldKey, 'from');
      const toKey = buildFilterNestedKey(item.fieldKey, 'to');
      initialFilters[fromKey] = '';
      initialFilters[toKey] = '';
      return {
        kind: 'dateRange',
        fromKey,
        toKey,
        label,
        width,
        showQuickOptions: true,
      } as FilterFieldConfig<Record<string, FilterValue>>;
    }
    case 'numberEqual': {
      const key = buildFilterKey(item.fieldKey);
      initialFilters[key] = '';
      return {
        kind: 'numberEqual',
        key,
        label,
        width,
      } as FilterFieldConfig<Record<string, FilterValue>>;
    }
    case 'numberRange': {
      const fromKey = buildFilterNestedKey(item.fieldKey, 'min');
      const toKey = buildFilterNestedKey(item.fieldKey, 'max');
      initialFilters[fromKey] = '';
      initialFilters[toKey] = '';
      return {
        kind: 'numberRange',
        fromKey,
        toKey,
        label,
        width,
      } as FilterFieldConfig<Record<string, FilterValue>>;
    }
    case 'switch':
      // v1.2 未实现 switch 控件；服务端 registry 亦不允许此 control 被保存到业务页，
      // 防御性忽略即可。
      return null;
  }
}

/** `filters[fieldKey]` — 单值 enum / entity / text */
function buildFilterKey(fieldKey: string): string {
  return `filters[${fieldKey}]`;
}

/** `filters[fieldKey][]` — 数组 enum / entity 多选 */
function buildFilterArrayKey(fieldKey: string): string {
  return `filters[${fieldKey}][]`;
}

/** `filters[fieldKey][nestedKey]` — range / date 边界 */
function buildFilterNestedKey(fieldKey: string, nestedKey: string): string {
  return `filters[${fieldKey}][${nestedKey}]`;
}

function resolveOptions(meta: FilterRegistryFieldMeta): FilterOption[] {
  if (meta.options && meta.options.length > 0) {
    return meta.options.map((opt) => ({ value: opt.value, label: opt.label }));
  }
  return [];
}

function resolveEntity(entity: string | null | undefined): FilterEntity | null {
  if (!entity) return null;
  return SUPPORTED_ENTITIES.includes(entity as FilterEntity) ? (entity as FilterEntity) : null;
}

/** 导出常量方便配置页/测试复用 */
export const FILTER_SCHEME_KEYWORD_FIELD_KEY = KEYWORD_FIELD_KEY;

/** 导出辅助函数，方便配置页做实时预览时共用生成逻辑 */
export function previewComposeScheme(detail: FilterSchemeDetailResponse): FilterSchemeResult {
  return composeScheme(detail);
}

/** 生成筛选方案的查询 key，供其他调用方（如 useSchemeVersionWatcher）做 invalidate */
export function filterSchemeQueryKey(pageKey: string): [string, string] {
  return ['filter-scheme', pageKey];
}

export type { FilterSchemeConfig };
