import type { FilterSchemeConfig } from '../schemas/filter-scheme';

export interface IFilterScheme {
  id: string;
  pageKey: string;
  configJson: FilterSchemeConfig;
  version: number;
  updatedAt: string;
  updatedBy: string | null;
}

export interface IFilterSchemeResponse extends IFilterScheme {}
