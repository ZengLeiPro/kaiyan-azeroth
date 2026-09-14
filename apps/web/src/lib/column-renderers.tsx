/**
 * 表格列渲染器注册表
 *
 * 与 `packages/shared/src/schemas/column-meta.ts` 的 `ColumnMeta.type` 字段对应：
 * schema 层只描述"这是什么类型"（如 'date' / 'decimal'），具体 React 渲染由本模块注册。
 *
 * 扩展点：
 * - 业务方可在任意启动时刻调用 `registerColumnRenderer('customType', fn)` 扩展新类型
 * - 页面级 `overrides` 里的 `render` 永远优先于此注册表
 *
 * Shared 包保持零 React 依赖，所有渲染器只能注册在 web 侧。
 */

import type { ColumnMeta, ColumnRendererType } from '@ky-azeroth/shared/schemas/column-meta';
import type { ReactNode } from 'react';

import { StatusBadge } from '@/components/patterns/status-badge';
import { Badge } from '@/components/ui/badge';
import { formatDateDisplay, formatDateTimeDisplay } from '@/lib/date-utils';

import { FALLBACK_COLOR } from './status-colors';
import { ALL_STATUS_MAPS, type StatusMap } from './status-maps';

export type ColumnRenderer = (value: unknown, row: unknown, meta: ColumnMeta) => ReactNode;

const registry = new Map<string, ColumnRenderer>();

/** 注册自定义渲染器（type → React 渲染函数） */
export function registerColumnRenderer(type: string, renderer: ColumnRenderer): void {
  registry.set(type, renderer);
}

/** 读取渲染器；返回 undefined 让调用方回落到 DataTable 默认 String(value) 逻辑 */
export function getColumnRenderer(
  type: ColumnRendererType | undefined
): ColumnRenderer | undefined {
  if (!type) return undefined;
  return registry.get(type);
}

// ========================================================================
// 内置渲染器（side-effect：import 本模块即完成注册）
// ========================================================================

const EMPTY = '-';

const asText = (v: unknown): string => (v == null || v === '' ? EMPTY : String(v));

registerColumnRenderer('text', (v) => asText(v));

registerColumnRenderer('date', (v) => {
  if (v == null || v === '') return EMPTY;
  const formatted = formatDateDisplay(v as string);
  if (!formatted) return EMPTY;
  return <span className="text-muted-foreground">{formatted}</span>;
});

registerColumnRenderer('datetime', (v) => {
  if (v == null || v === '') return EMPTY;
  const formatted = formatDateTimeDisplay(v as string | Date | number);
  if (!formatted) return EMPTY;
  return <span className="text-muted-foreground">{formatted}</span>;
});

registerColumnRenderer('decimal', (v) => {
  if (v == null || v === '') return EMPTY;
  const n = typeof v === 'number' ? v : Number(v);
  if (Number.isNaN(n)) return EMPTY;
  return <span className="font-mono tabular-nums">{n.toFixed(2)}</span>;
});

registerColumnRenderer('percent', (v) => {
  if (v == null || v === '') return EMPTY;
  const n = typeof v === 'number' ? v : Number(v);
  if (Number.isNaN(n)) return EMPTY;
  // 约定：schema 层数值已是百分数（如 85 表示 85%）；若是 0-1 区间由业务显式 * 100
  return <span className="font-mono tabular-nums">{n}%</span>;
});

registerColumnRenderer('serialNumber', (v) => (
  <span className="font-mono text-xs text-muted-foreground">{asText(v)}</span>
));

registerColumnRenderer('tagList', (v) => {
  if (!Array.isArray(v) || v.length === 0) return EMPTY;
  return v.filter(Boolean).join(', ');
});

// ========================================================================
// StatusBadge 注册表：statusMapKey → statusMap
// ========================================================================

// 接通全部已登记 map（status-maps.ts 的 ALL_STATUS_MAPS）。
// 今后新增 map 在 ALL_STATUS_MAPS 登记即自动生效，无需在此逐个注册。
const statusMaps: Record<string, StatusMap> = { ...ALL_STATUS_MAPS };

/** 注册额外的 StatusBadge map，支持业务扩展 */
export function registerStatusMap(key: string, map: StatusMap): void {
  statusMaps[key] = map;
}

registerColumnRenderer('statusBadge', (v, _row, meta) => {
  if (v == null || v === '') return EMPTY;
  const mapKey = meta.statusMapKey;
  if (!mapKey) return asText(v);
  const map = statusMaps[mapKey];
  if (!map) {
    // map 未注册时退化为纯文本，避免白屏
    return asText(v);
  }
  return <StatusBadge status={String(v)} statusMap={map} />;
});

// 数组 → 多个彩色小 Badge（如客户标签）。需 meta.statusMapKey 指向分类 map；未命中显示原值。
registerColumnRenderer('tagBadgeList', (v, _row, meta) => {
  if (!Array.isArray(v)) return EMPTY;
  const items = v.filter((x) => x != null && x !== '');
  if (items.length === 0) return EMPTY;
  const map = meta.statusMapKey ? statusMaps[meta.statusMapKey] : undefined;
  return (
    <div className="flex flex-wrap gap-1">
      {items.map((item, index) => {
        const key = String(item);
        const cfg = map?.[key];
        return (
          <Badge key={`${key}-${index}`} variant="soft" className={cfg?.color ?? FALLBACK_COLOR}>
            {cfg?.label ?? key}
          </Badge>
        );
      })}
    </div>
  );
});

// ========================================================================
// Link 渲染器（占位；具体 target 构建由业务方通过 linkTargetKey 注册）
// ========================================================================

type LinkTargetBuilder = (value: unknown, row: unknown) => { href: string; label: string };
const linkTargets = new Map<string, LinkTargetBuilder>();

export function registerLinkTarget(key: string, builder: LinkTargetBuilder): void {
  linkTargets.set(key, builder);
}

registerColumnRenderer('link', (v, row, meta) => {
  if (v == null || v === '') return EMPTY;
  const key = meta.linkTargetKey;
  if (!key) return asText(v);
  const builder = linkTargets.get(key);
  if (!builder) return asText(v);
  const { href, label } = builder(v, row);
  return (
    <a href={href} className="text-primary hover:underline" onClick={(e) => e.stopPropagation()}>
      {label}
    </a>
  );
});

// 'custom' 类型在 deriveColumnsFromSchema 里跳过内置渲染，必须由页面 overrides 提供 render
