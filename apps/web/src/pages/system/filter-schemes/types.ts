import type {
  FilterControlKind,
  FilterFieldDataType,
  FilterRegistryFieldMeta,
  FilterSchemeConfig,
  FilterSchemeDetailResponse,
  FilterSchemeSummary,
} from '@ky-azeroth/shared/schemas/filter-scheme';

/**
 * 配置页专用类型 —— 不直接操作 shared 的 FilterSchemeConfig，本地多一层
 * `draft` 包装以支持 dirty 标记、拖拽 id（fieldKey 自带唯一性）、keyword 状态。
 * 最终保存时再抛出为 FilterSchemeConfig 发送给后端。
 */
export interface FilterSchemeDraft {
  fields: Array<{
    fieldKey: string;
    control: FilterControlKind;
    label?: string | null;
    width?: string;
  }>;
  keyword: {
    enabled: boolean;
    fieldKeys: string[];
    placeholder: string;
  };
}

export type FilterSchemeSummaryWithDirty = FilterSchemeSummary & {
  dirty?: boolean;
};

/** 可添加字段分组（按 dataType） */
export interface AddableFieldGroup {
  dataType: FilterFieldDataType;
  label: string;
  fields: FilterRegistryFieldMeta[];
}

export function detailToDraft(detail: FilterSchemeDetailResponse): FilterSchemeDraft {
  return {
    fields: detail.config.fields.map((f) => ({
      fieldKey: f.fieldKey,
      control: f.control,
      label: f.label ?? null,
      width: f.width,
    })),
    keyword: {
      enabled: detail.config.keyword.enabled,
      fieldKeys: [...detail.config.keyword.fieldKeys],
      placeholder: detail.config.keyword.placeholder ?? '',
    },
  };
}

export function draftToConfig(draft: FilterSchemeDraft): FilterSchemeConfig {
  return {
    fields: draft.fields.map((f) => ({
      fieldKey: f.fieldKey,
      control: f.control,
      label: f.label ?? null,
      width: f.width,
    })),
    keyword: {
      enabled: draft.keyword.enabled,
      fieldKeys: [...draft.keyword.fieldKeys],
      placeholder: draft.keyword.placeholder.length > 0 ? draft.keyword.placeholder : null,
    },
  };
}

export const DATA_TYPE_LABELS: Record<FilterFieldDataType, string> = {
  enum: '枚举',
  string: '文本',
  date: '日期',
  foreignKey: '关联实体',
  decimal: '小数',
  int: '整数',
  boolean: '布尔',
};
