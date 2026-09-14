/**
 * 从 Zod response schema 派生 Excel 导出列 `ExcelColumn<T>[]`
 *
 * 与 `deriveColumnsFromSchema` 共用同一 meta 源，但产出的是 `export-excel.ts` 的
 * `ExcelColumn<T>` 结构（字符单位 width + 纯 text formatter）。
 *
 * px → 字符换算公式：
 *   exportWidth_chars =
 *     meta.exportWidth                                  // 显式指定
 *     ?? max(
 *         round(meta.width_px / pxPerChar),             // px 换算
 *         ceil(meta.label.length * LABEL_MIN_FACTOR)    // 保证中文表头不裁
 *       )
 *     ?? 15                                             // 完全无 width/exportWidth 时的兜底
 */

import { type ColumnRendererType, readColumnMeta } from '@ky-azeroth/shared/schemas/column-meta';
import type { z } from 'zod';

import type { ExcelColumn } from '@/lib/export-excel';

import { getExportFormatter } from './column-export-formatters';

const DEFAULT_PX_PER_CHAR = 7;
const LABEL_MIN_FACTOR = 1.8;
const FALLBACK_WIDTH = 15;

export interface DeriveExcelColumnsOptions<T> {
  include?: string[];
  exclude?: string[];
  /** 自定义 px→字符换算系数（不同字号/字体可调） */
  pxPerChar?: number;
  /**
   * 同 key 的覆盖（如业务方要改 header 文案、加自定义 formatter）。
   * 以 ExcelColumn<T> 形状提供，会覆盖 schema 派生结果。
   */
  overrides?: Array<Partial<ExcelColumn<T>> & { key: keyof T | string }>;
}

export function deriveExcelColumnsFromSchema<T>(
  responseSchema: z.ZodObject<z.ZodRawShape>,
  options: DeriveExcelColumnsOptions<T> = {}
): ExcelColumn<T>[] {
  const { include, exclude = [], pxPerChar = DEFAULT_PX_PER_CHAR, overrides = [] } = options;
  const shape = responseSchema.shape as Record<string, z.ZodTypeAny>;
  const keys = include ?? Object.keys(shape);
  const overrideByKey = new Map<string, Partial<ExcelColumn<T>> & { key: keyof T | string }>();
  for (const ov of overrides) {
    overrideByKey.set(String(ov.key), ov);
  }

  const out: Array<ExcelColumn<T> & { order: number }> = [];

  for (const key of keys) {
    if (exclude.includes(key)) continue;
    const fieldSchema = shape[key];
    if (!fieldSchema) continue;

    const meta = readColumnMeta(fieldSchema);
    if (!meta || meta.exportIgnore) continue;

    const width = resolveExportWidth(meta.exportWidth, meta.width, meta.label, pxPerChar);
    const formatterKey = meta.exportFormatterKey ?? defaultExportFormatterKey(meta.type);
    const formatter = formatterKey ? getExportFormatter(formatterKey) : undefined;

    const baseCol: ExcelColumn<T> = {
      header: meta.label,
      key: key as keyof T,
      width,
      ...(formatter ? { formatter: formatter as (v: unknown, row: T) => string | number } : {}),
    };

    const ov = overrideByKey.get(key);
    const merged: ExcelColumn<T> = ov ? { ...baseCol, ...ov } : baseCol;
    out.push({ ...merged, order: meta.order ?? 0 });
  }

  out.sort((a, b) => a.order - b.order);
  return out.map(({ order: _order, ...rest }) => {
    void _order;
    return rest as ExcelColumn<T>;
  });
}

function defaultExportFormatterKey(type: ColumnRendererType | undefined): string | undefined {
  switch (type) {
    case 'date':
      return 'dateYMD';
    case 'datetime':
      return 'datetime';
    case 'decimal':
      return 'decimal2';
    case 'percent':
      return 'percent';
    case 'tagList':
      return 'arrayJoin';
    default:
      return undefined;
  }
}

function resolveExportWidth(
  exportWidth: number | undefined,
  widthPx: number | undefined,
  label: string,
  pxPerChar: number
): number {
  if (exportWidth !== undefined) return exportWidth;
  const labelMin = Math.ceil((label?.length ?? 0) * LABEL_MIN_FACTOR);
  if (widthPx !== undefined) {
    return Math.max(Math.round(widthPx / pxPerChar), labelMin, 1);
  }
  return Math.max(labelMin, FALLBACK_WIDTH);
}
