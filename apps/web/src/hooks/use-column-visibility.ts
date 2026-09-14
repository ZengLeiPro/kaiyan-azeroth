import * as React from 'react';

import { buildTablePreferencePageKey, fetchTablePreference } from '@/lib/table-preferences';

// 列配置接口
export interface ColumnConfig {
  key: string;
  label: string;
  visible: boolean;
  canHide?: boolean; // 是否允许隐藏，默认 true
  /**
   * 列是否可排序。来自 schema `withColumn({sortable: true})` 派生。
   * 用于 ColumnVisibilityDropdown「保存为全员默认」时校验 sortBy 白名单。
   */
  sortable?: boolean;
  /**
   * 列的排序 key 别名（如果与 `key` 不同）。来自 schema `withColumn({sortKey})` 派生。
   * 配合 DataTable.handleSort 的 `column.sortKey || column.key` 维度对齐。
   */
  sortKey?: string;
}

export interface UseColumnVisibilityOptions {
  /**
   * 同路径下区分不同表格（如 tabs）用的命名空间 id，与 `useColumnWidths.options.storageId` 对齐。
   * 同时影响：
   * - 服务端 pageKey 拼接（pathname[:storageId]）
   * - localStorage key（pathname[:storageId]）—— 未传时仍按 pathname 单维度持久化，
   *   保证旧调用方（未传 storageId）的本地配置不丢失
   */
  storageId?: string;
  /**
   * 当 fetch table-preference 成功且 `server.config.sortBy` 命中本地 sortable 白名单时调用。
   * 用于让外层 useServerPagination 把 sorting state 同步到服务端全员默认值。
   * 入参 version 是服务端 TablePreference.version；接收方应做 B 模式覆盖（version > local 才应用）。
   */
  onServerSortingApplied?: (
    sortBy: string | undefined,
    sortOrder: 'asc' | 'desc' | undefined,
    version: number
  ) => void;
  /**
   * 本页可排序字段集合（来自 `columns.filter(c=>c.sortable).map(c=>c.sortKey||c.key)`）。
   * 用于在 apply server 的 sortBy 前做白名单校验，防止 admin 推了已下架字段导致 UI/数据不一致。
   * 不传时自动从 `initialColumns` 派生（要求 ColumnConfig 携带 sortable/sortKey 元数据）。
   */
  sortableKeys?: string[];
}

/** 从 ColumnConfig 列表派生 sortable 白名单 key（用于服务端 sorting 同步前的安全网） */
function deriveSortableKeysFromColumns(columns: ColumnConfig[]): string[] {
  return columns.filter((c) => c.sortable).map((c) => c.sortKey ?? c.key);
}

const STORAGE_PREFIX = 'column-visibility:';
const STORAGE_VERSION = 3;

interface Persisted {
  v: number;
  visibility: Record<string, boolean>;
  /** 列的水平顺序；缺省（undefined / 空数组）= 走 schema 默认 */
  order?: string[];
  appliedServerVersion: number;
}

function buildStorageKey(storageId?: string): string {
  const base = STORAGE_PREFIX + window.location.pathname;
  return storageId ? `${base}:${storageId}` : base;
}

/**
 * 读取持久化值。兼容历史格式：
 * - v3：完整结构（visibility + order + appliedServerVersion）
 * - v2：visibility + appliedServerVersion，order 回落 undefined
 * - v1（裸 Record<string, boolean>）：仅 visibility，appliedServerVersion=0、order=undefined
 */
function loadPersisted(storageId?: string): Persisted | null {
  try {
    const raw = localStorage.getItem(buildStorageKey(storageId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === 'object') {
      const obj = parsed as Partial<Persisted> & Record<string, unknown>;
      if (obj.v === STORAGE_VERSION && obj.visibility && typeof obj.visibility === 'object') {
        return {
          v: STORAGE_VERSION,
          visibility: obj.visibility as Record<string, boolean>,
          order: Array.isArray(obj.order) ? (obj.order as string[]) : undefined,
          appliedServerVersion:
            typeof obj.appliedServerVersion === 'number' ? obj.appliedServerVersion : 0,
        };
      }
      // 兼容 v2：visibility + appliedServerVersion，无 order
      if (obj.v === 2 && obj.visibility && typeof obj.visibility === 'object') {
        return {
          v: STORAGE_VERSION,
          visibility: obj.visibility as Record<string, boolean>,
          order: undefined,
          appliedServerVersion:
            typeof obj.appliedServerVersion === 'number' ? obj.appliedServerVersion : 0,
        };
      }
      // 兼容 v1：裸的 Record<string, boolean>
      if (!('v' in obj)) {
        return {
          v: STORAGE_VERSION,
          visibility: parsed as Record<string, boolean>,
          order: undefined,
          appliedServerVersion: 0,
        };
      }
    }
    return null;
  } catch {
    return null;
  }
}

function writePersisted(payload: Persisted, storageId?: string): void {
  try {
    localStorage.setItem(buildStorageKey(storageId), JSON.stringify(payload));
  } catch {
    // localStorage 写入失败时静默忽略
  }
}

/**
 * 把 visibility / order 合到 initialColumns 上，并按 order 排好序。
 * - order 里没有的 key（schema 新增列）排到末尾，保留 schema 内部顺序
 * - order 里有但 schema 没有的 key（已下架列）自然不出现在结果里
 */
function applyOrder(
  initial: ColumnConfig[],
  visibility: Record<string, boolean>,
  order: string[] | undefined
): ColumnConfig[] {
  const merged = initial.map((col) => ({
    ...col,
    visible: col.key in visibility ? (visibility[col.key] ?? col.visible) : col.visible,
  }));
  if (!order || order.length === 0) return merged;
  const orderIndex = new Map(order.map((k, i) => [k, i]));
  // stable sort：order 里的按 order 索引；其余维持 initial 的相对位置（追加到尾部）
  const knownLastIndex = order.length;
  return merged
    .map((col, i) => ({ col, fallbackIndex: knownLastIndex + i }))
    .sort((a, b) => {
      const oa = orderIndex.get(a.col.key) ?? a.fallbackIndex;
      const ob = orderIndex.get(b.col.key) ?? b.fallbackIndex;
      return oa - ob;
    })
    .map((x) => x.col);
}

// 列显隐 + 排序控制 Hook
export function useColumnVisibility(
  initialColumns: ColumnConfig[],
  options: UseColumnVisibilityOptions = {}
) {
  const { storageId, onServerSortingApplied, sortableKeys } = options;

  // 稳定回调引用，避免父组件每次 render 新建函数触发 fetch effect 重跑
  const onServerSortingAppliedRef = React.useRef(onServerSortingApplied);
  React.useLayoutEffect(() => {
    onServerSortingAppliedRef.current = onServerSortingApplied;
  }, [onServerSortingApplied]);
  // sortableKeys 用 ref 透传：优先 options，回退到从 initialColumns 派生
  // 避免数组引用变化触发重跑（白名单本身随 schema 稳定）
  const sortableKeysRef = React.useRef<string[]>(
    sortableKeys ?? deriveSortableKeysFromColumns(initialColumns)
  );
  React.useLayoutEffect(() => {
    sortableKeysRef.current = sortableKeys ?? deriveSortableKeysFromColumns(initialColumns);
  }, [sortableKeys, initialColumns]);

  // 冷启动：本地有持久化值就用本地，没有就回落 initialColumns 原始 visible（尊重 hidden 默认）
  const initialPersistedRef = React.useRef<Persisted | null>(null);
  if (initialPersistedRef.current === null) {
    initialPersistedRef.current = loadPersisted(storageId);
  }

  const [columns, setColumns] = React.useState<ColumnConfig[]>(() => {
    const persisted = initialPersistedRef.current;
    if (!persisted) {
      return initialColumns.map((col) => ({ ...col }));
    }
    return applyOrder(initialColumns, persisted.visibility, persisted.order);
  });

  // 已应用的服务端 version：mount 时从 localStorage 读，server 强制覆盖时更新
  const appliedServerVersionRef = React.useRef<number>(
    initialPersistedRef.current?.appliedServerVersion ?? 0
  );
  // 当前生效的 order（用于持久化时一并落入）；初始来自 localStorage 或 undefined
  const orderRef = React.useRef<string[] | undefined>(initialPersistedRef.current?.order);

  // 标记用户是否修改过（用于决定是否写入 localStorage）
  const userModified = React.useRef(false);

  // storageId 运行时切换：重新加载对应 key 的持久化值，清除旧状态。
  // 与 `useColumnWidths` 对齐 —— 审批中心按 Tab 切换 storageId 时需要立刻读到对应 Tab
  // 的列显隐/顺序，否则会串表。
  const prevStorageIdRef = React.useRef(storageId);
  // 引用最新 initialColumns，避免 effect 依赖父组件 render 出的新引用而循环
  const initialColumnsRef = React.useRef(initialColumns);
  React.useLayoutEffect(() => {
    initialColumnsRef.current = initialColumns;
  }, [initialColumns]);
  React.useLayoutEffect(() => {
    if (prevStorageIdRef.current === storageId) return;
    prevStorageIdRef.current = storageId;
    userModified.current = false;
    const next = loadPersisted(storageId);
    appliedServerVersionRef.current = next?.appliedServerVersion ?? 0;
    orderRef.current = next?.order;
    if (!next) {
      setColumns(initialColumnsRef.current.map((col) => ({ ...col })));
    } else {
      setColumns(applyOrder(initialColumnsRef.current, next.visibility, next.order));
    }
  }, [storageId]);

  // columns 变化时持久化（仅用户修改后）
  React.useEffect(() => {
    if (!userModified.current) return;
    const visibility: Record<string, boolean> = {};
    for (const col of columns) {
      visibility[col.key] = col.visible;
    }
    writePersisted(
      {
        v: STORAGE_VERSION,
        visibility,
        order: orderRef.current,
        appliedServerVersion: appliedServerVersionRef.current,
      },
      storageId
    );
  }, [columns, storageId]);

  // 服务端同步：mount 时拉一次全员默认配置；若 version > 本地 applied 则强制覆盖
  // 注：不放 initialColumns 依赖，避免父组件每次 render 新建数组触发重复请求
  const pageKey = React.useMemo(
    () =>
      typeof window === 'undefined'
        ? ''
        : buildTablePreferencePageKey(window.location.pathname, storageId),
    [storageId]
  );
  React.useEffect(() => {
    let cancelled = false;
    if (!pageKey) return;
    fetchTablePreference(pageKey).then((server) => {
      if (cancelled) return;
      if (!server) return;

      // sorting 应用通道：无论 visibility/order 是否变化，都尝试透出 sortBy/sortOrder
      // 给外层 useServerPagination 自己判 version 决定是否覆盖（applyServerSorting 内 B 模式）
      const serverSortBy = server.config.sortBy;
      const serverSortOrder = server.config.sortOrder;
      const cb = onServerSortingAppliedRef.current;
      if (cb) {
        // 白名单校验：sortBy 不在 sortableKeys 中时静默忽略
        const allowed = sortableKeysRef.current;
        const sortByValid =
          !serverSortBy || !allowed || allowed.length === 0 || allowed.includes(serverSortBy);
        if (sortByValid) {
          cb(serverSortBy, serverSortOrder, server.version);
        }
      }

      if (server.version <= appliedServerVersionRef.current) return;
      const serverVisibility = server.config.visibility;
      const serverOrder = server.config.order;
      if (!serverVisibility && (!serverOrder || serverOrder.length === 0)) return;

      // 强制覆盖：用 server 的 visibility / order 重写 state + localStorage
      appliedServerVersionRef.current = server.version;
      const nextOrder = Array.isArray(serverOrder) ? serverOrder : orderRef.current;
      orderRef.current = nextOrder;

      // 计算合并后的 visibility map（保留 schema 默认 + 服务端覆盖）
      const visMap: Record<string, boolean> = {};
      for (const col of initialColumns) {
        visMap[col.key] = serverVisibility
          ? col.key in serverVisibility
            ? (serverVisibility[col.key] ?? col.visible)
            : col.visible
          : col.visible;
      }
      setColumns(applyOrder(initialColumns, visMap, nextOrder));
      writePersisted(
        {
          v: STORAGE_VERSION,
          visibility: visMap,
          order: nextOrder,
          appliedServerVersion: server.version,
        },
        storageId
      );
    });
    return () => {
      cancelled = true;
    };
    // initialColumns 引用通常每次 render 都新建（如 useMemo 漏写依赖），这里有意忽略；
    // 列集合本身在生命周期内是稳定的（来自页面 schema）。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageKey]);

  const toggleColumn = React.useCallback((key: string) => {
    userModified.current = true;
    setColumns((prev) =>
      prev.map((col) =>
        col.key === key && col.canHide !== false ? { ...col, visible: !col.visible } : col
      )
    );
  }, []);

  const showAll = React.useCallback(() => {
    userModified.current = true;
    setColumns((prev) => prev.map((col) => ({ ...col, visible: true })));
  }, []);

  /**
   * 重置到 `initialColumns` 原始可见性 + schema 默认顺序，同时清空 localStorage。
   */
  const resetToDefault = React.useCallback(() => {
    try {
      localStorage.removeItem(buildStorageKey(storageId));
    } catch {
      // ignore
    }
    appliedServerVersionRef.current = 0;
    orderRef.current = undefined;
    userModified.current = false;
    setColumns(initialColumns.map((col) => ({ ...col })));
  }, [initialColumns, storageId]);

  /**
   * 拖拽后由 ColumnVisibilityDropdown 调用：传入新的 key 顺序数组。
   * 注意：传入的 newKeyOrder 应当与当前 columns 数组一一对应（仅顺序不同）。
   */
  const reorderColumns = React.useCallback((newKeyOrder: string[]) => {
    userModified.current = true;
    orderRef.current = newKeyOrder;
    setColumns((prev) => {
      const indexMap = new Map(newKeyOrder.map((k, i) => [k, i]));
      const fallback = newKeyOrder.length;
      return [...prev].sort((a, b) => {
        const oa = indexMap.get(a.key) ?? fallback;
        const ob = indexMap.get(b.key) ?? fallback;
        return oa - ob;
      });
    });
  }, []);

  const getVisibleColumns = React.useCallback(() => {
    return columns.filter((col) => col.visible);
  }, [columns]);

  const isColumnVisible = React.useCallback(
    (key: string) => {
      const col = columns.find((c) => c.key === key);
      return col?.visible ?? true;
    },
    [columns]
  );

  /** 「保存为全员默认」按钮使用：取当前生效的列 key 顺序 */
  const getCurrentOrder = React.useCallback((): string[] => {
    return columns.map((col) => col.key);
  }, [columns]);

  /**
   * 让外层（如「保存为全员默认」按钮）能把本地 appliedServerVersion 同步到刚刚 PUT 返回的版本，
   * 避免管理员推送后自己页面又把同一份配置「再覆盖一次」（无害但徒增一次抖动）。
   */
  const markServerVersionApplied = React.useCallback(
    (version: number) => {
      appliedServerVersionRef.current = version;
      const visibility: Record<string, boolean> = {};
      for (const col of columns) {
        visibility[col.key] = col.visible;
      }
      writePersisted(
        {
          v: STORAGE_VERSION,
          visibility,
          order: orderRef.current,
          appliedServerVersion: version,
        },
        storageId
      );
    },
    [columns, storageId]
  );

  return {
    columns,
    toggleColumn,
    reorderColumns,
    showAll,
    resetToDefault,
    getVisibleColumns,
    isColumnVisible,
    getCurrentOrder,
    markServerVersionApplied,
  };
}
