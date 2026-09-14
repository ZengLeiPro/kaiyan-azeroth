import { z } from 'zod';

/**
 * 表格列 UI 元数据
 *
 * 附着机制：通过 `.describe('@columnMeta:<JSON>')` 挂在 Zod 字段 schema 上，
 * 让后端 `createZodDto`、前端 `useCrud`、CLI schema 扫描均零破坏（详见 README 顶部注释）。
 *
 * 用法：仅在 `xxxResponseSchema` 字段上使用；create/update schema 保持纯净。
 *
 * @example
 * ```ts
 * import { withColumn } from './column-meta';
 * import { COL_AMOUNT, COL_DATE } from './column-widths';
 *
 * export const invoiceResponseSchema = z.object({
 *   id: z.string(),
 *   invoiceAmount: withColumn(z.coerce.number(), {
 *     label: '发票金额', width: COL_AMOUNT, align: 'right', type: 'decimal',
 *   }),
 *   invoiceDate: withColumn(z.string().optional().nullable(), {
 *     label: '开票日期', width: COL_DATE, type: 'date', sortable: true,
 *   }),
 * });
 * ```
 */

/** 渲染器类型，指向 web 侧 `column-renderers.tsx` 的注册表 key */
export type ColumnRendererType =
  | 'text' //        默认文本，null/undefined/空字符串 → '-'
  | 'date' //        yyyy-MM-dd
  | 'datetime' //    yyyy-MM-dd HH:mm
  | 'decimal' //     右对齐 font-mono，2 位小数
  | 'percent' //     "85%"
  | 'serialNumber' // font-mono，小号字
  | 'statusBadge' // 需 statusMapKey 指定 map
  | 'link' //        穿透按钮/链接；需 linkTargetKey
  | 'tagList' //     数组 join(', ')
  | 'tagBadgeList' // 数组 → 多个彩色 Badge（需 statusMapKey）
  | 'custom'; //     页面级 overrides 覆盖 render

export interface ColumnMeta {
  /** 列头文本（必填，用作 DataTableColumn.header 与 ExcelColumn.header） */
  label: string;

  // ========== 显示宽度（px）==========
  /** 固定宽度 */
  width?: number;
  /** 最小宽度，默认 120（DEFAULT_COL_MIN_WIDTH） */
  minWidth?: number;
  /** 最大宽度 */
  maxWidth?: number;

  // ========== 显示样式 ==========
  /** 单元格对齐 */
  align?: 'left' | 'center' | 'right';
  /** 超长省略（默认 true） */
  ellipsis?: boolean;

  // ========== 交互 ==========
  /** 表头是否可点击排序 */
  sortable?: boolean;
  /** 排序字段名（与列 key 不同时指定） */
  sortKey?: string;

  // ========== 渲染器 ==========
  /** 渲染器类型，查 web 侧 column-renderers 注册表 */
  type?: ColumnRendererType;
  /** 当 type='statusBadge' 时指向 status-maps 的 key */
  statusMapKey?: string;
  /** 当 type='link' 时指向 link-targets 注册表的 key */
  linkTargetKey?: string;

  // ========== 可见性 ==========
  /** 默认是否隐藏（对应现有 ColumnConfig.visible=false） */
  hidden?: boolean;
  /** 不允许用户隐藏（如序号、主名称列） */
  required?: boolean;

  // ========== Excel 导出 ==========
  /**
   * xlsx 字符单位宽度；缺省时按 `max(round(width_px / 7), ceil(label.length * 1.8))` 自动换算
   */
  exportWidth?: number;
  /** 导出格式化器 key，查 web 侧 column-export-formatters 注册表 */
  exportFormatterKey?: string;
  /** 导出时跳过该列 */
  exportIgnore?: boolean;

  // ========== 顺序 ==========
  /** 列顺序数值覆盖（越小越靠前）；未设置时按 schema shape 枚举顺序 */
  order?: number;
}

const COLUMN_META_MARKER = '@columnMeta:';

/**
 * 给 Zod 字段 schema 附加列元数据。返回同类型 schema（保持 typeName 不变，对校验链零侵入）。
 *
 * 注意：
 * - 务必在字段 schema 上调用（如 `z.string()`、`z.number().optional()`），
 *   而不是在顶层 `z.object({...})` 上。
 * - 若字段本身已经有 `.describe('人类可读')`，会被保留并拼接在 meta JSON 之前。
 */
export function withColumn<S extends z.ZodTypeAny>(schema: S, meta: ColumnMeta): S {
  const existing = schema.description ?? '';
  // 剥离旧的 meta 部分（幂等性）：允许 withColumn(withColumn(s, m1), m2) 覆盖
  const humanPart = existing.split(COLUMN_META_MARKER)[0] ?? '';
  const payload = `${humanPart}${COLUMN_META_MARKER}${JSON.stringify(meta)}`;
  return schema.describe(payload) as S;
}

/**
 * 穿透 `ZodOptional / ZodNullable / ZodDefault / ZodEffects` 取到底层 schema。
 * 用于从 `z.string().optional().nullable()` 这种包装链上读取 meta。
 *
 * 实现细节：
 * - ZodOptional/ZodNullable/ZodDefault 的 `_def.innerType` 指向下一层
 * - ZodEffects 的 `_def.schema` 指向下一层
 * - 这里循环最多 16 层，防止异常输入形成死循环
 */
export function unwrapDeep(schema: z.ZodTypeAny): z.ZodTypeAny {
  let current: z.ZodTypeAny = schema;
  for (let i = 0; i < 16; i += 1) {
    // Zod 的 _def 是 readonly 泛型，这里我们只读：强制断言为 any 访问私有字段
    const def = (
      current as unknown as { _def?: { innerType?: z.ZodTypeAny; schema?: z.ZodTypeAny } }
    )._def;
    if (def?.innerType) {
      current = def.innerType;
      continue;
    }
    if (def?.schema) {
      current = def.schema;
      continue;
    }
    break;
  }
  return current;
}

/**
 * 从 Zod schema 读出列元数据。
 *
 * 查找顺序：
 * 1. schema 自身的 description
 * 2. unwrapDeep(schema) 的 description（处理 `.optional().nullable()` 等包装）
 *
 * 未挂 meta 时返回 `undefined`（而非抛错），让表格派生方能优雅跳过。
 */
export function readColumnMeta(schema: z.ZodTypeAny): ColumnMeta | undefined {
  const direct = parseFromDescription(schema.description);
  if (direct) return direct;
  const inner = unwrapDeep(schema);
  if (inner !== schema) {
    return parseFromDescription(inner.description);
  }
  return undefined;
}

function parseFromDescription(desc: string | undefined): ColumnMeta | undefined {
  if (!desc) return undefined;
  const idx = desc.indexOf(COLUMN_META_MARKER);
  if (idx < 0) return undefined;
  const jsonPart = desc.slice(idx + COLUMN_META_MARKER.length);
  try {
    const parsed = JSON.parse(jsonPart) as unknown;
    if (parsed && typeof parsed === 'object') {
      return parsed as ColumnMeta;
    }
  } catch (err) {
    // 破损 marker 在 dev 模式下给出警告，便于调试；production 保持静默
    if (typeof process !== 'undefined' && process.env && process.env.NODE_ENV !== 'production') {
      console.warn('[readColumnMeta] 解析 columnMeta JSON 失败：', err, jsonPart);
    }
  }
  return undefined;
}

/**
 * 剥离 `@columnMeta:` 前缀，返回人类可读的 description 部分。
 * CLI 生成文档/注释时用，避免把 JSON 字符串塞进代码注释里。
 */
export function stripColumnMetaMarker(desc: string | undefined): string | undefined {
  if (!desc) return desc;
  const idx = desc.indexOf(COLUMN_META_MARKER);
  if (idx < 0) return desc;
  const human = desc.slice(0, idx);
  return human.length > 0 ? human : undefined;
}
