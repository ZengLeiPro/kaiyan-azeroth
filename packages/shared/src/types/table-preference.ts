import type { TablePreferenceConfig } from '../schemas/table-preference';

export interface ITablePreferenceConfig {
  visibility?: Record<string, boolean>;
  widths?: Record<string, number>;
  order?: string[];
  /** 默认排序字段，使用前端 sortKey || column.key 维度（与后端 resolveOrderBy 白名单同维度） */
  sortBy?: string;
  /** 默认排序方向；缺省时由 page hard-coded 兜底 */
  sortOrder?: 'asc' | 'desc';
}

export interface ITablePreference {
  id: string;
  pageKey: string;
  config: TablePreferenceConfig;
  version: number;
  createdAt: string | Date;
  updatedAt: string | Date;
}

export interface ITablePreferenceResponse extends ITablePreference {}

export interface IUpsertTablePreference {
  pageKey: string;
  config: TablePreferenceConfig;
}
