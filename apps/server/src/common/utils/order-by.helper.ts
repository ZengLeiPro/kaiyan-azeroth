/**
 * 列表排序构造器
 *
 * 用途：把前端 (sortBy, sortOrder) 解析为 Prisma 的 orderBy 对象。
 *
 * 设计要点：
 * 1. sortBy 必须命中白名单才生效，否则兜底——既防注入（`__proto__`、不存在字段），
 *    也防全表扫描非索引列（Service 层应只把索引覆盖的字段列入白名单）。
 * 2. 白名单用 `ReadonlySet<string>` 而非对象字面量，避免 prototype 污染。
 * 3. aliasMap 显式声明前端字段名 → 实际 Prisma 字段名（例：`status → loginStatus`）。
 *    aliasMap 命中需先经过白名单过滤，所以入参 `__proto__` 之类不会落到 aliasMap。
 * 4. sortOrder 缺省为 'desc'，与 paginationSchema 默认值一致。
 * 5. nullsPolicy 显式声明字段的 NULL 排序位置；不配置走 PG 默认（ASC=NULLS LAST、
 *    DESC=NULLS FIRST）。常见诉求是「列表降序时 NULL 不要霸占第一页」——给字段标
 *    `'nullsLast'` 即可，会输出 `{ field: { sort, nulls: 'last' } }` 的 Prisma 语法。
 *
 * 用法：
 *   const PAYMENT_SORT_WHITELIST = new Set([
 *     'createdAt', 'updatedAt', 'businessDate', 'paymentAmount',
 *   ]);
 *
 *   const orderBy = resolveOrderBy<Prisma.PaymentOrderByWithRelationInput>(
 *     query.sortBy,
 *     query.sortOrder,
 *     { whitelist: PAYMENT_SORT_WHITELIST, fallback: { createdAt: 'desc' } },
 *   );
 *
 *   // 让某字段降序时 NULL 排尾（升序仍走 PG 默认 NULLS LAST）：
 *   const orderBy = resolveOrderBy<Prisma.CustomerOrderByWithRelationInput>(
 *     query.sortBy,
 *     query.sortOrder,
 *     {
 *       whitelist: CUSTOMER_SORT_WHITELIST,
 *       fallback: { createdAt: 'desc' },
 *       nullsPolicy: { lastKeepRecordTime: 'nullsLast' },
 *     },
 *   );
 */

export type SortOrder = 'asc' | 'desc';
export type NullsPosition = 'first' | 'last';

/**
 * 单字段的 NULL 排序策略。
 * - 'nullsLast'：不论升降序，NULL 都排尾（最常用——避免 NULL 霸占降序第一页）。
 * - 'nullsFirst'：不论升降序，NULL 都排头（少见，留扩展）。
 * - 对象形式：分别声明 ASC / DESC 时的 NULL 位置（更精细的场景）。
 */
export type FieldNullsPolicy =
  | 'nullsLast'
  | 'nullsFirst'
  | { onAsc?: NullsPosition; onDesc?: NullsPosition };

export interface ResolveOrderByOptions<TOrderBy> {
  /** 允许的前端字段名白名单（命中后才返回 sortBy） */
  whitelist: ReadonlySet<string>;
  /** 白名单未命中或 sortBy 缺省时的兜底排序 */
  fallback: TOrderBy;
  /**
   * 可选：前端字段名 → 实际 Prisma 字段名映射。
   * 白名单 key 必须用「前端字段名」（aliasMap 命中前），不要塞 Prisma 真实字段。
   */
  aliasMap?: Readonly<Record<string, string>>;
  /**
   * 可选：按字段声明 NULL 排序策略；未声明的字段走 PG 默认行为。
   * key 用「前端字段名」（与 whitelist 同维度，aliasMap 命中前）。
   */
  nullsPolicy?: Readonly<Record<string, FieldNullsPolicy>>;
}

/**
 * 解析单字段 nulls 策略 → 实际要输出的 NULL 位置（命中则返回 'first'/'last'，未命中返回 undefined 走 PG 默认）。
 */
function resolveNullsPosition(
  policy: FieldNullsPolicy | undefined,
  order: SortOrder
): NullsPosition | undefined {
  if (!policy) return undefined;
  if (policy === 'nullsLast') return 'last';
  if (policy === 'nullsFirst') return 'first';
  return order === 'asc' ? policy.onAsc : policy.onDesc;
}

/**
 * 解析前端排序参数为 Prisma orderBy。
 *
 * @param sortBy 前端传入的排序字段（来自 paginationSchema.sortBy）
 * @param sortOrder 前端传入的排序方向（来自 paginationSchema.sortOrder）
 * @param options 白名单/兜底/别名/nulls 策略配置
 */
export function resolveOrderBy<TOrderBy>(
  sortBy: string | undefined,
  sortOrder: SortOrder | undefined,
  options: ResolveOrderByOptions<TOrderBy>
): TOrderBy {
  if (!sortBy || !options.whitelist.has(sortBy)) {
    return options.fallback;
  }
  const field = options.aliasMap?.[sortBy] ?? sortBy;
  const order: SortOrder = sortOrder ?? 'desc';
  // nulls 策略按「前端字段名」查（与 whitelist 同维度），不是 alias 后的实际字段
  const nulls = resolveNullsPosition(options.nullsPolicy?.[sortBy], order);
  if (nulls) {
    return { [field]: { sort: order, nulls } } as TOrderBy;
  }
  return { [field]: order } as TOrderBy;
}
