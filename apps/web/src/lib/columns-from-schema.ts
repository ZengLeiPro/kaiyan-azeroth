/**
 * 从 Zod response schema 派生 `DataTableColumn<T>[]`
 *
 * 输入：xxxResponseSchema（字段上已通过 `withColumn` 挂 `ColumnMeta`）+ 页面级 overrides
 * 输出：DataTable 需要的 columns 数组
 *
 * 页面级 overrides 永远优先于 schema meta，支持四种合并模式：
 * - 'override'（默认）：按字段覆盖 schema 生成列的单个属性
 * - 'replace'：彻底替换该 key 的列（不合并 schema meta）
 * - 'after'：追加虚拟列到末尾（key 不在 schema 里）
 * - 'before'：追加虚拟列到开头
 */

import { type ColumnMeta, readColumnMeta } from '@ky-azeroth/shared/schemas/column-meta';
import type { ReactNode } from 'react';
import type { z } from 'zod';

import type { DataTableColumn } from '@/components/ui/data-table';

import { getColumnRenderer } from './column-renderers';

/**
 * 页面级列覆盖。
 * - 指向 schema 已有字段时，默认 mode='override'，只合并覆盖字段，保留 schema 生成的 header/width 等
 * - mode='replace' 时完全替换（可用于重写复杂列）
 * - mode='after' / 'before' 时作为虚拟列插入（key 不需要在 schema shape 里）
 */
export interface ColumnOverride<T> extends Partial<DataTableColumn<T>> {
  key: string;
  mode?: 'override' | 'replace' | 'after' | 'before';
}

export interface DeriveColumnsOptions<T> {
  /**
   * 显式白名单 + 顺序。
   * 提供时：按 `include` 数组顺序输出，**忽略** `meta.order`。
   * 不提供时：按 schema shape 枚举顺序，并受 `meta.order` 升序微调。
   */
  include?: string[];
  /** 黑名单 */
  exclude?: string[];
  /** 页面级覆盖 */
  overrides?: ColumnOverride<T>[];
}

/** 生成 DataTable 列定义（仅派生有 ColumnMeta 的字段） */
export function deriveColumnsFromSchema<T>(
  responseSchema: z.ZodObject<z.ZodRawShape>,
  options: DeriveColumnsOptions<T> = {}
): DataTableColumn<T>[] {
  const { include, exclude = [], overrides = [] } = options;
  const shape = responseSchema.shape as Record<string, z.ZodTypeAny>;

  const overrideByKey = new Map<string, ColumnOverride<T>>();
  const beforeVirtuals: ColumnOverride<T>[] = [];
  const afterVirtuals: ColumnOverride<T>[] = [];
  for (const ov of overrides) {
    if (ov.mode === 'before') {
      beforeVirtuals.push(ov);
    } else if (ov.mode === 'after' && !(ov.key in shape)) {
      afterVirtuals.push(ov);
    } else {
      overrideByKey.set(ov.key, ov);
    }
  }

  const schemaKeys = include ?? Object.keys(shape);
  const schemaColumns: Array<{ col: DataTableColumn<T>; order: number }> = [];

  for (const key of schemaKeys) {
    if (exclude.includes(key)) continue;
    const fieldSchema = shape[key];
    if (!fieldSchema) continue;

    const meta = readColumnMeta(fieldSchema);
    const ov = overrideByKey.get(key);

    // replace 模式：忽略 schema meta，完全用 override
    if (ov?.mode === 'replace') {
      schemaColumns.push({
        col: { header: key, ...stripMode(ov), key } as DataTableColumn<T>,
        order: meta?.order ?? 0,
      });
      continue;
    }

    // 无 meta 且无 override：跳过（字段仅用于表单/校验，不上表格）
    if (!meta && !ov) continue;

    const baseCol = metaToColumn<T>(key, meta);
    const merged: DataTableColumn<T> = ov
      ? ({ ...baseCol, ...stripMode(ov) } as DataTableColumn<T>)
      : baseCol;

    schemaColumns.push({ col: merged, order: meta?.order ?? 0 });
  }

  // order 稳定排序（undefined 视为 0；同 order 保留原顺序）
  // 但若调用方显式给了 include（用作"白名单 + 顺序"），则以 include 顺序为准，不被 meta.order 覆盖
  if (!include) {
    schemaColumns.sort((a, b) => a.order - b.order);
  }

  const ordered: DataTableColumn<T>[] = [
    ...beforeVirtuals.map((ov) => ({ header: ov.key, ...stripMode(ov) }) as DataTableColumn<T>),
    ...schemaColumns.map((c) => c.col),
    ...afterVirtuals.map((ov) => ({ header: ov.key, ...stripMode(ov) }) as DataTableColumn<T>),
  ];

  return ordered;
}

function stripMode<T>(ov: ColumnOverride<T>): Partial<DataTableColumn<T>> {
  const { mode: _mode, ...rest } = ov;
  void _mode;
  return rest;
}

/** 把 ColumnMeta 翻译为 DataTableColumn（不含业务 render 的部分） */
function metaToColumn<T>(key: string, meta: ColumnMeta | undefined): DataTableColumn<T> {
  if (!meta) {
    return { key, header: key };
  }
  const col: DataTableColumn<T> = {
    key,
    header: meta.label,
  };
  if (meta.width !== undefined) col.width = meta.width;
  if (meta.minWidth !== undefined) col.minWidth = meta.minWidth;
  if (meta.maxWidth !== undefined) col.maxWidth = meta.maxWidth;
  if (meta.align !== undefined) col.align = meta.align;
  if (meta.ellipsis !== undefined) col.ellipsis = meta.ellipsis;
  if (meta.sortable !== undefined) col.sortable = meta.sortable;
  if (meta.sortKey !== undefined) col.sortKey = meta.sortKey;

  // 绑定内置渲染器
  const type = meta.type;
  if (type && type !== 'custom') {
    const renderer = getColumnRenderer(type);
    if (renderer) {
      col.render = (item: T) => {
        const value = (item as Record<string, unknown>)[key];
        return renderer(value, item, meta) as ReactNode;
      };
    }
  }

  return col;
}

/**
 * 从 responseSchema 派生列可见性配置（`ColumnConfig[]`），供 `useColumnVisibility` 消费。
 *
 * 与 `deriveColumnsFromSchema` 共用同一 meta 源：`meta.hidden=true` → `visible=false`、
 * `meta.required=true` → `canHide=false`。
 */
export function deriveColumnVisibilityConfig(
  responseSchema: z.ZodObject<z.ZodRawShape>,
  options: { include?: string[]; exclude?: string[] } = {}
): Array<{
  key: string;
  label: string;
  visible: boolean;
  canHide?: boolean;
  sortable?: boolean;
  sortKey?: string;
}> {
  const { include, exclude = [] } = options;
  const shape = responseSchema.shape as Record<string, z.ZodTypeAny>;
  const keys = include ?? Object.keys(shape);
  const configs: Array<{
    key: string;
    label: string;
    visible: boolean;
    canHide?: boolean;
    sortable?: boolean;
    sortKey?: string;
    order: number;
  }> = [];

  for (const key of keys) {
    if (exclude.includes(key)) continue;
    const meta = readColumnMeta(shape[key] ?? ({} as z.ZodTypeAny));
    if (!meta) continue;
    configs.push({
      key,
      label: meta.label,
      visible: !meta.hidden,
      canHide: meta.required ? false : undefined,
      // 注入 sortable 元数据：供 useColumnVisibility / ColumnVisibilityDropdown 派生白名单
      sortable: meta.sortable,
      sortKey: meta.sortKey,
      order: meta.order ?? 0,
    });
  }

  configs.sort((a, b) => a.order - b.order);
  return configs.map(({ order: _order, ...rest }) => {
    void _order;
    return rest;
  });
}
