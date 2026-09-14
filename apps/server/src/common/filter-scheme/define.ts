import type {
  FilterControlKind,
  FilterFieldDataType,
  FilterOption,
  FilterRegistryFieldMeta,
  FilterRegistryMeta,
  FilterSchemeConfig,
} from '@ky-azeroth/shared/schemas/filter-scheme';

export type {
  FilterControlKind,
  FilterFieldDataType,
  FilterOption,
  FilterRegistryFieldMeta,
  FilterRegistryMeta,
  FilterSchemeConfig,
} from '@ky-azeroth/shared/schemas/filter-scheme';

export interface FilterDateValue {
  from?: string;
  to?: string;
}

export interface FilterRangeValue {
  min?: number;
  max?: number;
}

export type FilterFieldBuildValue =
  | string
  | string[]
  | number
  | boolean
  | FilterDateValue
  | FilterRangeValue;

export type FilterWhereFragment = Record<string, unknown>;

export interface FilterFieldDef {
  label: string;
  dataType: FilterFieldDataType;
  allowedControls: FilterControlKind[];
  searchable?: boolean;
  entity?: string;
  isScopeField?: boolean;
  optionsSource?: () => FilterOption[];
  build: (value: FilterFieldBuildValue) => FilterWhereFragment | null;
}

export interface FilterRegistry {
  pageKey: string;
  pageName?: string;
  fields: Record<string, FilterFieldDef>;
  defaults: FilterSchemeConfig;
}

export function defineFilterRegistry<TRegistry extends FilterRegistry>(
  options: TRegistry
): TRegistry {
  return options;
}

export function serializeFilterRegistry(registry: FilterRegistry): FilterRegistryMeta {
  const fields: FilterRegistryFieldMeta[] = Object.entries(registry.fields).map(
    ([fieldKey, def]) => ({
      fieldKey,
      label: def.label,
      dataType: def.dataType,
      allowedControls: def.allowedControls,
      searchable: def.searchable,
      entity: def.entity,
      isScopeField: def.isScopeField,
      options: def.optionsSource?.(),
    })
  );

  return {
    pageKey: registry.pageKey,
    pageName: registry.pageName,
    defaults: registry.defaults,
    fields,
  };
}
