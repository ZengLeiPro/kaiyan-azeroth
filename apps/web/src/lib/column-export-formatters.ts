/**
 * Excel 导出列格式化器注册表
 *
 * 与 `ColumnMeta.exportFormatterKey` 对应，用于 Excel 导出时把原始值转为 string/number。
 *
 * 扩展：`registerExportFormatter('myKey', (v, row) => ...)`
 */

import {
  INTENT_TEMPERATURE_LABELS,
  LEAD_VALIDITY_LABELS,
} from '@ky-azeroth/shared/constants/status-labels';

import { formatDateDisplay, formatDateTimeDisplay } from '@/lib/date-utils';

export type ExportFormatter = (value: unknown, row: unknown) => string | number;

const registry = new Map<string, ExportFormatter>();

export function registerExportFormatter(key: string, formatter: ExportFormatter): void {
  registry.set(key, formatter);
}

export function getExportFormatter(key: string | undefined): ExportFormatter | undefined {
  if (!key) return undefined;
  return registry.get(key);
}

// ========================================================================
// 内置格式化器
// ========================================================================

const asString = (v: unknown): string => (v == null || v === '' ? '' : String(v));

registerExportFormatter('text', (v) => asString(v));

registerExportFormatter('intentTemperature', (v) =>
  v == null || v === '' ? '' : (INTENT_TEMPERATURE_LABELS[String(v)] ?? String(v))
);

registerExportFormatter('leadValidity', (v) =>
  v == null || v === '' ? '' : (LEAD_VALIDITY_LABELS[String(v)] ?? String(v))
);

registerExportFormatter('dateYMD', (v) => {
  if (v == null || v === '') return '';
  return formatDateDisplay(v as string) || '';
});

registerExportFormatter('datetime', (v) => {
  if (v == null || v === '') return '';
  return formatDateTimeDisplay(v as string | Date | number);
});

registerExportFormatter('decimal2', (v) => {
  if (v == null || v === '') return '';
  const n = typeof v === 'number' ? v : Number(v);
  if (Number.isNaN(n)) return '';
  return n.toFixed(2);
});

registerExportFormatter('number', (v) => {
  if (v == null || v === '') return '';
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isNaN(n) ? '' : n;
});

registerExportFormatter('percent', (v) => {
  if (v == null || v === '') return '';
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isNaN(n) ? '' : `${n}%`;
});

registerExportFormatter('arrayJoin', (v) => {
  if (!Array.isArray(v) || v.length === 0) return '';
  return v.filter(Boolean).join(', ');
});
