import * as React from 'react';

import { logger } from '@/lib/logger';
import { buildTablePreferencePageKey, fetchTablePreference } from '@/lib/table-preferences';

/**
 * 列宽持久化 Hook
 *
 * 结构参照 `use-column-visibility.ts`：
 * - localStorage key：`column-widths:${pathname}` 或 `column-widths:${pathname}:${storageId}`
 * - `userModified` ref：首次渲染不写入 localStorage，避免用默认值覆盖历史记录
 * - 300ms 防抖：拖拽过程中 state 高频更新，落盘只做一次
 * - STORAGE_VERSION：未来 schema 改动时 bump 版本，旧数据自动失效
 * - `latestWidthsRef`：避免 effect 闭包捕获旧 widths 在卸载时覆盖最新值
 * - `suppressPersistRef`：reset 流程不走防抖写回，保证 `removeItem` 语义
 * - `appliedServerVersion`：管理员推送的全员默认配置版本号；mount 时拉取服务端，
 *   若 server.version > 本地 applied 则强制覆盖本地 widths（B 模式：强制覆盖）。
 *
 * 新列自动回落 `ColumnWidthSpec.defaultWidth`；用户可通过 `onResetColumn` / `onResetAll`
 * 清除覆盖，让列宽回到 schema 默认。
 *
 * 同路径多表隔离：通过 `options.storageId` 区分（如 ApprovalsPage 的 tab key）。
 */

export interface ColumnWidthSpec {
  key: string;
  defaultWidth?: number;
  minWidth?: number;
  maxWidth?: number;
}

export interface UseColumnWidthsOptions {
  /**
   * 同路径下区分不同表格（如 tabs）用的命名空间 id。
   * 不传时 key 退回 `column-widths:${pathname}`。
   */
  storageId?: string;
}

const STORAGE_PREFIX = 'column-widths:';
const STORAGE_VERSION = 2;
const DEBOUNCE_MS = 300;
const DEFAULT_MIN = 60;
const DEFAULT_MAX = 1200;
const FALLBACK_WIDTH = 160;

/** 全局重置列宽事件名（由 ColumnVisibilityDropdown 触发） */
export const COLUMN_WIDTHS_RESET_EVENT = 'kya:column-widths:reset';

interface ResetEventDetail {
  /** 指定 storageId 时，只重置匹配的 hook；不指定时重置当前路径所有 hook */
  storageId?: string;
}

interface Persisted {
  v: number;
  widths: Record<string, number>;
  /** 已应用的服务端全员默认 version，用于判断"是否需要强制覆盖" */
  appliedServerVersion: number;
}

function buildStorageKey(pathname: string, storageId?: string): string {
  const base = STORAGE_PREFIX + pathname;
  return storageId ? `${base}:${storageId}` : base;
}

/**
 * 触发重置当前路径的列宽。
 *
 * 实现细节（避免幽灵 bug）：
 * 1. 先 dispatch 事件让所有订阅 hook 设置 `suppressPersistRef=true` 再 `setWidths({})`
 * 2. 然后 `removeItem` 清 localStorage
 *
 * effect 里因为 `suppressPersistRef=true` 会跳过一次持久化，保证 localStorage 不被
 * 空 widths `{v:1,widths:{}}` 重新覆写而是真正保持 removed。
 */
export function dispatchColumnWidthsReset(storageId?: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.dispatchEvent(
      new CustomEvent<ResetEventDetail>(COLUMN_WIDTHS_RESET_EVENT, { detail: { storageId } })
    );
  } catch {
    // ignore
  }
  try {
    const prefix = STORAGE_PREFIX + window.location.pathname;
    if (storageId) {
      localStorage.removeItem(`${prefix}:${storageId}`);
    } else {
      // 清当前路径下所有列宽 key（含主 key 和带 storageId 的子 key）
      const toRemove: string[] = [];
      for (let i = 0; i < localStorage.length; i += 1) {
        const key = localStorage.key(i);
        if (key && (key === prefix || key.startsWith(`${prefix}:`))) {
          toRemove.push(key);
        }
      }
      toRemove.forEach((k) => localStorage.removeItem(k));
    }
  } catch {
    // SSR / 隐私模式忽略
  }
}

interface ReadResult {
  widths: Record<string, number>;
  appliedServerVersion: number;
}

const EMPTY_READ_RESULT: ReadResult = { widths: {}, appliedServerVersion: 0 };

/**
 * 读取持久化值。
 * - v2：直接返回 { widths, appliedServerVersion }
 * - v1（仅 widths）：兼容读取，appliedServerVersion 回落 0
 */
function readPersistedWidths(storageKey: string): ReadResult {
  if (typeof window === 'undefined') return EMPTY_READ_RESULT;
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return EMPTY_READ_RESULT;
    const parsed = JSON.parse(raw) as Partial<Persisted>;
    if (!parsed || !parsed.widths || typeof parsed.widths !== 'object') return EMPTY_READ_RESULT;
    if (parsed.v === STORAGE_VERSION) {
      return {
        widths: parsed.widths,
        appliedServerVersion:
          typeof parsed.appliedServerVersion === 'number' ? parsed.appliedServerVersion : 0,
      };
    }
    // 兼容 v1：仅 widths，无 appliedServerVersion
    if (parsed.v === 1) {
      return { widths: parsed.widths, appliedServerVersion: 0 };
    }
    return EMPTY_READ_RESULT;
  } catch (err) {
    logger.warn('UseColumnWidths', 'localStorage 解析失败，已忽略', err);
    return EMPTY_READ_RESULT;
  }
}

/**
 * 读取指定 storageId 当前 localStorage 中的列宽快照（供「保存为全员默认」按钮使用）。
 * 用调用方所在路径的 pathname。
 */
export function readCurrentColumnWidths(storageId?: string): Record<string, number> {
  if (typeof window === 'undefined') return {};
  const key = buildStorageKey(window.location.pathname, storageId);
  return readPersistedWidths(key).widths;
}

/** 手动清空当前路径的列宽 localStorage（兼容旧 API） */
export function clearColumnWidthsForCurrentPath(): void {
  try {
    localStorage.removeItem(STORAGE_PREFIX + window.location.pathname);
  } catch {
    // ignore
  }
}

export function useColumnWidths(columns: ColumnWidthSpec[], options: UseColumnWidthsOptions = {}) {
  const { storageId } = options;

  // snapshot 挂载时的 pathname，避免拖拽中路由切换导致未落盘 widths 写到新 pathname 的 key
  const mountPathnameRef = React.useRef<string>(
    typeof window !== 'undefined' ? window.location.pathname : ''
  );

  const storageKey = React.useMemo(
    () => buildStorageKey(mountPathnameRef.current, storageId),
    [storageId]
  );

  // 首次冷启动：同时从持久化中拿 widths 和 appliedServerVersion
  const initialReadRef = React.useRef<ReadResult | null>(null);
  if (initialReadRef.current === null) {
    initialReadRef.current = readPersistedWidths(
      buildStorageKey(mountPathnameRef.current, storageId)
    );
  }
  const [widths, setWidths] = React.useState<Record<string, number>>(
    () => initialReadRef.current!.widths
  );
  const appliedServerVersionRef = React.useRef<number>(
    initialReadRef.current!.appliedServerVersion
  );

  // 始终指向最新的 widths，供 effect/timer/unmount 使用。
  // **同步**由 onResize / onResetAll / onResetColumn / reset handler / storageId 切换 effect
  // 在调用 setWidths 前更新，保证即使"onResize 后同一批次立即 unmount"也能落最新值。
  // 下面的 useEffect 只作为兜底同步（StrictMode 下 state 可能被重置但 ref 未跟上时回灌）。
  const latestWidthsRef = React.useRef(widths);
  React.useEffect(() => {
    latestWidthsRef.current = widths;
  }, [widths]);

  const userModified = React.useRef(false);
  const suppressPersistRef = React.useRef(false);
  const saveTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  // 有未持久化的改动时为 true；timer flush 完或 reset 时为 false
  const pendingSaveRef = React.useRef(false);
  // 当前 storageKey 的 ref，供 flush/timer 使用（随 storageId 切换实时更新）
  const storageKeyRef = React.useRef(storageKey);
  React.useEffect(() => {
    storageKeyRef.current = storageKey;
  }, [storageKey]);

  // storageId 运行时切换：重新加载对应 key 的持久化值，清除旧状态。
  // 切换前先 flush 旧 key 的未落盘改动（避免用户在 tab A 刚拖完列宽、
  // 300ms 内切到 tab B 时 tab A 的改动丢失）。
  const prevStorageIdRef = React.useRef(storageId);
  const prevStorageKeyRef = React.useRef(storageKey);
  React.useEffect(() => {
    if (prevStorageIdRef.current === storageId) return;
    // 1. flush 到旧 key（若有待保存改动）
    if (pendingSaveRef.current) {
      try {
        const payload: Persisted = {
          v: STORAGE_VERSION,
          widths: latestWidthsRef.current,
          appliedServerVersion: appliedServerVersionRef.current,
        };
        localStorage.setItem(prevStorageKeyRef.current, JSON.stringify(payload));
      } catch {
        // ignore
      }
    }
    // 2. 更新 ref 指针到新 key
    prevStorageIdRef.current = storageId;
    prevStorageKeyRef.current = storageKey;
    // 3. 清防抖 timer + 重置状态
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    userModified.current = false;
    pendingSaveRef.current = false;
    suppressPersistRef.current = true; // 忽略切换引发的 setWidths 触发的 effect
    // 4. 读取新 key 的持久化值（widths 与 appliedServerVersion 都要重置到新 key 的）
    const next = readPersistedWidths(storageKey);
    latestWidthsRef.current = next.widths;
    appliedServerVersionRef.current = next.appliedServerVersion;
    setWidths(next.widths);
  }, [storageId, storageKey]);

  const flushSave = React.useCallback(() => {
    try {
      const payload: Persisted = {
        v: STORAGE_VERSION,
        widths: latestWidthsRef.current,
        appliedServerVersion: appliedServerVersionRef.current,
      };
      localStorage.setItem(storageKeyRef.current, JSON.stringify(payload));
    } catch {
      // localStorage 满 / 隐私模式禁用时静默忽略
    }
  }, []);

  // 防抖写入
  // 注意 suppressPersistRef 优先级高于 userModified：
  // 即使用户从未修改过（reset 后"清空"产生的 setWidths），也要 consume flag，
  // 否则 flag 会残留到下一次 onResize 被错误吞掉。
  React.useEffect(() => {
    if (suppressPersistRef.current) {
      // reset / storageId 切换触发：跳过这一次，消费掉 flag
      suppressPersistRef.current = false;
      pendingSaveRef.current = false;
      return;
    }
    if (!userModified.current) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      saveTimerRef.current = null;
      pendingSaveRef.current = false;
      flushSave();
    }, DEBOUNCE_MS);
    return () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
    };
  }, [widths, flushSave]);

  // 卸载时 flush（从 ref 读最新值，避免 stale closure）
  // 注意：effect 的 cleanup 倒序执行（此 effect 声明在防抖 effect 之后，
  // 但 React cleanup 顺序是正向，所以此 cleanup 先于防抖 effect cleanup 运行；
  // 无论顺序如何，都靠 pendingSaveRef 判定是否需要 flush，不依赖 saveTimerRef）
  React.useEffect(() => {
    return () => {
      if (pendingSaveRef.current && !suppressPersistRef.current) {
        flushSave();
        pendingSaveRef.current = false;
      }
    };
  }, [flushSave]);

  // 监听全局 reset 事件
  React.useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<ResetEventDetail>).detail;
      if (detail?.storageId !== undefined && detail.storageId !== storageId) return;
      // 同步消息：先清防抖 timer，避免它落地写回
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
      suppressPersistRef.current = true;
      // 不再把 userModified 置 false：保留"用户已交互"语义，避免下次 resize
      // 进入 effect 时被 `!userModified` early-return 误伤。
      pendingSaveRef.current = false;
      latestWidthsRef.current = {};
      // 重置后下次 mount 应允许 server 默认重新应用
      appliedServerVersionRef.current = 0;
      setWidths({});
    };
    window.addEventListener(COLUMN_WIDTHS_RESET_EVENT, handler);
    return () => window.removeEventListener(COLUMN_WIDTHS_RESET_EVENT, handler);
  }, [storageId]);

  // 服务端全员默认同步：mount 时拉取，若 server.version > 本地 applied 则强制覆盖本地 widths
  const serverPageKey = React.useMemo(
    () =>
      typeof window === 'undefined'
        ? ''
        : buildTablePreferencePageKey(mountPathnameRef.current, storageId),
    [storageId]
  );
  React.useEffect(() => {
    let cancelled = false;
    if (!serverPageKey) return;
    fetchTablePreference(serverPageKey).then((server) => {
      if (cancelled) return;
      if (!server || !server.config.widths) return;
      if (server.version <= appliedServerVersionRef.current) return;

      // 强制覆盖：写本地 state + localStorage，更新 appliedServerVersion
      const overrideWidths = server.config.widths;
      appliedServerVersionRef.current = server.version;
      // 取消 pending 防抖（避免它用旧 widths 覆盖 server 值）
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
      pendingSaveRef.current = false;
      // 暂时压制下面那条 `widths` 监听 effect 的 timer 写回（让我们的同步写赢）
      suppressPersistRef.current = true;
      latestWidthsRef.current = overrideWidths;
      setWidths(overrideWidths);
      // 同步写一次 localStorage，落入新的 appliedServerVersion
      try {
        const payload: Persisted = {
          v: STORAGE_VERSION,
          widths: overrideWidths,
          appliedServerVersion: server.version,
        };
        localStorage.setItem(storageKeyRef.current, JSON.stringify(payload));
      } catch {
        // ignore
      }
    });
    return () => {
      cancelled = true;
    };
  }, [serverPageKey]);

  // columns 变化时缓存 spec（用于 clamp）
  const specMap = React.useMemo(() => {
    const m = new Map<string, ColumnWidthSpec>();
    for (const c of columns) m.set(c.key, c);
    return m;
  }, [columns]);

  const clampFor = React.useCallback(
    (key: string, w: number): number => {
      const spec = specMap.get(key);
      const min = spec?.minWidth ?? DEFAULT_MIN;
      const max = spec?.maxWidth ?? DEFAULT_MAX;
      return Math.min(max, Math.max(min, Math.round(w)));
    },
    [specMap]
  );

  const onResize = React.useCallback(
    (key: string, width: number) => {
      const prev = latestWidthsRef.current;
      const next = clampFor(key, width);
      if (prev[key] === next) return;
      userModified.current = true;
      pendingSaveRef.current = true;
      const updated = { ...prev, [key]: next };
      latestWidthsRef.current = updated; // 同步更新，覆盖 ref-sync effect 的延迟
      setWidths(updated);
    },
    [clampFor]
  );

  const onResetAll = React.useCallback(() => {
    // 主动清 storage 并抑制 effect 写回，保证真正 removed
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    try {
      localStorage.removeItem(storageKeyRef.current);
    } catch {
      // ignore
    }
    suppressPersistRef.current = true;
    // 不改动 userModified（保留"用户已交互"语义，让下次 resize 能正常持久化）
    pendingSaveRef.current = false;
    latestWidthsRef.current = {};
    // 重置 appliedServerVersion：让下次 mount/fetch 拿到的 server 默认能重新生效
    appliedServerVersionRef.current = 0;
    setWidths({});
  }, []);

  const onResetColumn = React.useCallback((key: string) => {
    const prev = latestWidthsRef.current;
    if (!(key in prev)) return;
    userModified.current = true;
    pendingSaveRef.current = true;
    const next = { ...prev };
    delete next[key];
    latestWidthsRef.current = next;
    setWidths(next);
  }, []);

  const getWidth = React.useCallback(
    (key: string): number => {
      if (widths[key] !== undefined) return widths[key];
      const spec = specMap.get(key);
      return spec?.defaultWidth ?? FALLBACK_WIDTH;
    },
    [widths, specMap]
  );

  /**
   * 给外层（如「保存为全员默认」按钮）同步 appliedServerVersion：admin 推送成功后
   * 自身页面也认领这个新版本，避免在下一次刷新前被同一份 server 配置"再覆盖一次"。
   * 写本次最新 widths（不是空对象）到 localStorage，保留管理员手里此刻的拖拽结果。
   */
  const markServerVersionApplied = React.useCallback((version: number) => {
    appliedServerVersionRef.current = version;
    try {
      const payload: Persisted = {
        v: STORAGE_VERSION,
        widths: latestWidthsRef.current,
        appliedServerVersion: version,
      };
      localStorage.setItem(storageKeyRef.current, JSON.stringify(payload));
    } catch {
      // ignore
    }
  }, []);

  return {
    widths,
    onResize,
    onResetAll,
    onResetColumn,
    getWidth,
    markServerVersionApplied,
  };
}
