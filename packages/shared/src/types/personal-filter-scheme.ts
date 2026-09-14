import type { FilterSchemeConfig } from '../schemas/filter-scheme';
import type { FilterValues } from '../schemas/personal-filter-scheme';

/** 当前用户在单个列表页面的筛选项展示偏好。 */
export interface IPersonalFilterPreference {
  id: string;
  employeeId: string;
  pageKey: string;
  config: FilterSchemeConfig;
  version: number;
  createdAt: string | Date;
  updatedAt: string | Date;
}

/** 当前用户保存的命名筛选条件方案。 */
export interface IPersonalFilterPreset {
  id: string;
  employeeId: string;
  pageKey: string;
  name: string;
  filters: FilterValues;
  version: number;
  createdAt: string | Date;
  updatedAt: string | Date;
}
