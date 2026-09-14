/**
 * API 参数处理工具函数
 *
 * 提供统一的 API 请求参数清理和处理功能，避免空字符串、null、undefined
 * 等无效值传递到后端。
 */

/**
 * 清理对象中的空值（空字符串、null、undefined）
 * 保留 0 和 false 等有效值
 *
 * @param params - 原始参数对象
 * @returns 清理后的参数对象
 *
 * @example
 * cleanParams({ name: 'foo', age: 0, city: '', status: null })
 * // => { name: 'foo', age: 0 }
 */
export function cleanParams<T extends Record<string, unknown>>(params: T): Partial<T> {
  return Object.entries(params).reduce((acc, [key, value]) => {
    // 保留 0, false 等有效值，移除 '', null, undefined
    if (value === '' || value === null || value === undefined) return acc;
    // 移除空数组（多选筛选未选中任何项时等同于"全部"）
    if (Array.isArray(value) && value.length === 0) return acc;
    (acc as Record<string, unknown>)[key] = value;
    return acc;
  }, {} as Partial<T>);
}

/**
 * 条件性添加参数（仅当值为 truthy 时添加）
 *
 * 注意：此函数会过滤掉 0 和 false，如果需要保留这些值，请使用 cleanParams
 *
 * @param params - 原始参数对象
 * @returns 过滤后的参数对象
 *
 * @example
 * conditionalParams({ name: 'foo', age: 0, city: '' })
 * // => { name: 'foo' }  (注意：0 被过滤)
 */
export function conditionalParams<T extends Record<string, unknown>>(params: T): Partial<T> {
  const result: Partial<T> = {};
  for (const [key, value] of Object.entries(params)) {
    if (value) {
      (result as Record<string, unknown>)[key] = value;
    }
  }
  return result;
}

/**
 * 合并必需参数和可选参数
 *
 * @param required - 必需参数（不会被清理）
 * @param optional - 可选参数（会被清理空值）
 * @returns 合并后的参数对象
 *
 * @example
 * mergeParams(
 *   { page: 1, pageSize: 10 },
 *   { keyword: '', status: 'active' }
 * )
 * // => { page: 1, pageSize: 10, status: 'active' }
 */
export function mergeParams<R extends Record<string, unknown>, O extends Record<string, unknown>>(
  required: R,
  optional: O
): R & Partial<O> {
  return {
    ...required,
    ...cleanParams(optional),
  };
}
