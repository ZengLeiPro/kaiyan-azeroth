import { createContext, useContext } from 'react';

interface FilterContextValue {
  /** 关闭筛选抽屉（移动端） */
  closeFilterSheet?: () => void;
}

export const FilterContext = createContext<FilterContextValue>({});

export function useFilterContext() {
  return useContext(FilterContext);
}
