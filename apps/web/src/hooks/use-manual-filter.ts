import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ZodTypeAny } from 'zod';

import { logger } from '@/lib/logger';
import { cleanParams } from '@/utils/api-helpers';

/**
 * 筛选字段值类型：单选用 `string`，多选用 `string[]`
 */
export type FilterValue = string | string[];

/**
 * 手动筛选 hook
 * 用于实现"输入后点击搜索按钮才查询"的筛选模式
 *
 * @param initialFilters 初始筛选条件
 * @param transformParams 可选的参数转换函数，用于将前端字段映射到后端 API 参数
 * @param querySchemaOrVersion 可选的第三参数，支持两种用途（互斥）：
 *   1. `ZodTypeAny` — shared query schema(通常是 `queryXxxSchema.pick({...})`)。
 *      开发环境下会对生成的 apiParams 做 safeParse,失败时 logger.warn,
 *      不抛错、不影响运行时行为。用于在开发期尽早发现字段名错写或类型不匹配。
 *   2. `number` — scheme 版本号。当 `useFilterScheme()` 拉到新版本配置时，
 *      本 hook 会 reset 当前 filter state；引用变化本身不会触发 reset，
 *      避免 admin 改配置时用户正在输入被冲掉。
 *
 * 若两种都要传，使用签名重载的第 4 参数 `schemeVersion`（见重载声明）。
 * @param schemeVersion 可选，`useFilterScheme().version`。仅当 `querySchemaOrVersion`
 *                      是 zod schema 时才需要用这个参数单独传 version。
 */
export function useManualFilter<T extends Record<string, FilterValue>>(
  initialFilters: T,
  transformParams?: (filters: T) => Record<string, FilterValue | undefined>,
  querySchemaOrVersion?: ZodTypeAny | number,
  schemeVersion?: number
) {
  // 解析第 3 参数：如果是 number 就当 version，否则当 zod schema
  const resolvedQuerySchema: ZodTypeAny | undefined =
    typeof querySchemaOrVersion === 'object' && querySchemaOrVersion !== null
      ? querySchemaOrVersion
      : undefined;
  const resolvedVersion: number | undefined =
    typeof querySchemaOrVersion === 'number' ? querySchemaOrVersion : schemeVersion;

  // 临时筛选状态（用户输入，不触发查询）
  const [tempFilters, setTempFilters] = useState<T>(initialFilters);
  // 实际查询参数（点击搜索后才更新）
  const [activeFilters, setActiveFilters] = useState<T>(initialFilters);

  // 仅在 schemeVersion 变化时重置，避免 admin 改配置时用户正在输入被冲掉。
  // 首次挂载时 prevVersion === undefined，比较 `version !== undefined && !== prev` 保证不误触发。
  const prevVersionRef = useRef<number | undefined>(resolvedVersion);
  useEffect(() => {
    if (resolvedVersion === undefined) return;
    if (prevVersionRef.current !== resolvedVersion) {
      prevVersionRef.current = resolvedVersion;
      setTempFilters(initialFilters);
      setActiveFilters(initialFilters);
    }
    // 依赖 initialFilters：当 version 变化时，同时读取最新的 initialFilters 引用。
    // 但我们只在 version 变化时才 set，引用变化本身不会进入 setter，保证用户输入不被冲掉。
  }, [resolvedVersion, initialFilters]);

  // 设置单个筛选字段
  const setFilter = useCallback(<K extends keyof T>(key: K, value: T[K]) => {
    setTempFilters((prev) => ({ ...prev, [key]: value }));
  }, []);

  // 批量设置筛选字段
  const setFilters = useCallback((updates: Partial<T>) => {
    setTempFilters((prev) => ({ ...prev, ...updates }));
  }, []);

  /**
   * 批量设置并立即生效（绕过"点搜索才查询"模式）。
   * 用于程序化触发筛选场景，如外部钻取传参、URL 同步等。
   * 与"setFilters + search"不同的是单次 render 内 temp/active 同时更新，
   * 不会因 setFilters 是异步而让随后的 search 读到旧 tempFilters。
   */
  const applyFilters = useCallback((updates: Partial<T>) => {
    setTempFilters((prev) => ({ ...prev, ...updates }));
    setActiveFilters((prev) => ({ ...prev, ...updates }));
  }, []);

  /**
   * 精确替换当前页面可见筛选字段，用于应用个人方案。
   * 不保留方案之外的旧条件，也不会恢复已从当前配置隐藏的字段。
   */
  const replaceFilters = useCallback(
    (updates: Partial<T>) => {
      const next = { ...initialFilters };
      for (const key of Object.keys(next) as Array<keyof T>) {
        if (updates[key] !== undefined) next[key] = updates[key] as T[typeof key];
      }
      setTempFilters(next);
      setActiveFilters(next);
    },
    [initialFilters]
  );

  // 点击搜索按钮
  const search = useCallback(() => {
    setActiveFilters({ ...tempFilters });
  }, [tempFilters]);

  // 重置筛选
  const reset = useCallback(() => {
    setTempFilters(initialFilters);
    setActiveFilters(initialFilters);
  }, [initialFilters]);

  // 检查是否有活跃的筛选条件
  const hasActiveFilters = useMemo(() => {
    return Object.values(activeFilters).some((v) => (Array.isArray(v) ? v.length > 0 : v !== ''));
  }, [activeFilters]);

  // 将筛选条件转换为后端 API 参数
  const apiParams = useMemo(() => {
    let raw: Record<string, FilterValue | undefined>;
    if (transformParams) {
      raw = transformParams(activeFilters);
    } else {
      // 默认转换：空字符串/空数组转为 undefined
      raw = {};
      for (const [key, value] of Object.entries(activeFilters)) {
        if (Array.isArray(value)) {
          raw[key] = value.length > 0 ? value : undefined;
        } else {
          raw[key] = value || undefined;
        }
      }
    }
    const cleaned = cleanParams(raw);

    // 开发环境:用 shared query schema 校验 API 参数契约(不抛错,只 warn)
    if (import.meta.env.DEV && resolvedQuerySchema) {
      const result = resolvedQuerySchema.safeParse(cleaned);
      if (!result.success) {
        logger.warn(
          'useManualFilter',
          'querySchema 校验失败,字段名可能写错或与 shared 契约不匹配。issues:',
          result.error.issues,
          'params:',
          cleaned
        );
      }
    }

    return cleaned;
  }, [activeFilters, transformParams, resolvedQuerySchema]);

  return {
    // 状态
    tempFilters,
    activeFilters,
    hasActiveFilters,
    apiParams,
    // 方法
    setFilter,
    setFilters,
    applyFilters,
    replaceFilters,
    search,
    reset,
  };
}
