import { Decimal } from '@prisma/client/runtime/library';

/**
 * Decimal/number 转为 number（用于 API Response 的读取转换）
 * 处理 Prisma 返回的 Decimal 类型字段
 */
export function toDecimalNumber(value: Decimal | number | null | undefined): number {
  if (value === null || value === undefined) return 0;
  return value instanceof Decimal ? value.toNumber() : Number(value);
}

/**
 * Date/string 转为 YYYY-MM-DD 格式的日期字符串
 * 用于 API Response 中只需要日期部分的字段
 */
export function toDateOnlyString(date: Date | string | null | undefined): string | null {
  if (!date) return null;
  const iso = date instanceof Date ? date.toISOString() : date;
  return iso.slice(0, 10);
}

/**
 * 计算分页参数
 * @returns { skip, take } 用于 Prisma findMany
 */
export function calculatePagination(
  page: number,
  pageSize: number
): { skip: number; take: number } {
  return { skip: (page - 1) * pageSize, take: pageSize };
}

/**
 * 将单个值从 Prisma 类型转为 JSON 安全类型
 * Date → ISO string, Decimal → number, 嵌套对象递归处理
 */
function serializeValue(value: unknown): unknown {
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (value instanceof Decimal) {
    return value.toNumber();
  }
  if (Array.isArray(value)) {
    return value.map(serializeValue);
  }
  if (value !== null && typeof value === 'object') {
    return serializeRecord(value as Record<string, unknown>);
  }
  return value;
}

/**
 * 递归序列化一个 Record 的所有值
 */
function serializeRecord(entity: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(entity)) {
    result[key] = serializeValue(value);
  }
  return result;
}

/**
 * 将 Prisma 实体序列化为 API 响应格式
 *
 * 转换规则：
 * - Date → ISO 8601 string
 * - Decimal → number（兜底处理；业务代码应优先用 toDecimalNumber 显式转换 Decimal 字段）
 * - 嵌套对象/数组 → 递归处理
 * - 其余原始值 → 原样保留
 *
 * 类型安全说明：
 * 泛型 T 用于指定目标类型（通常是 shared 的 *ResponseOutput）。
 * 由于 Prisma 实体与 API 响应之间存在 Date→string / Decimal→number 的结构性差异，
 * TypeScript 无法自动推导此转换，因此在函数内部使用了类型断言。
 * 字段完整性由 Response Schema（Zod）和 check:all 自动化检查共同保障。
 *
 * @param entity Prisma 返回的实体对象（可包含 Date/Decimal/嵌套关联）
 * @returns 序列化后的 JSON 安全对象
 */
export function serializeEntity<T>(entity: Record<string, unknown>): T {
  // @ts-expect-error: Prisma 实体经过 Date→string/Decimal→number 转换后结构与 T 一致，
  // 但 TS 无法自动推导此跨类型映射，由 Response Schema + check:all 保障字段完整性
  return serializeRecord(entity);
}
