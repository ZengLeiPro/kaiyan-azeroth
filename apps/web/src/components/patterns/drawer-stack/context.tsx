import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useLocation } from 'react-router-dom';

import { BeforeCloseGuardProvider } from './before-close-context';
import { HeaderActionsProvider } from './header-actions-context';

/**
 * 支持「叠加抽屉」的实体类型。注册新实体须同步在 entity-registry.tsx 中提供 render。
 */
export type DrawerEntityType =
  | 'customer'
  | 'sale-order'
  | 'opportunity'
  | 'payment'
  | 'invoice'
  | 'keep-record'
  | 'visit-record'
  | 'contact';

/**
 * 抽屉条目模式：
 * - `detail`（默认）：展示已有实体详情，由 entity-registry.render(id) 渲染
 * - `create`：在抽屉栈内打开创建表单，由 entity-registry.renderCreate(presets) 渲染
 */
export type DrawerEntryMode = 'detail' | 'create';

export interface DrawerEntry {
  /** React key，由 push 时自增计数生成，确保稳定唯一 */
  key: string;
  type: DrawerEntityType;
  /**
   * 实体 id。create 模式下没有真实 id，调用方传 `__create__` 占位即可（去重逻辑会跳过 create 模式，
   * 不依赖该值的唯一性）。
   */
  id: string;
  /** 模式，默认 detail */
  mode?: DrawerEntryMode;
  /**
   * create 模式专用：预填字段（如 customerId 锁定到当前客户）。
   * detail 模式下应忽略此字段。
   */
  presets?: Record<string, unknown>;
  /**
   * detail 模式专用：调用方可传入来源上下文。
   * 典型场景：审批中心按 approvalInstanceId 打开业务详情时，把审批实例信息传给详情视图。
   */
  context?: Record<string, unknown>;
  /** 面包屑/返回按钮上显示的标题，调用方可在 push 时附带 */
  title?: string;
}

/** 最近一次栈变化的方向，DrawerStackHost 用来选 slide-in 动画方向。 */
export type DrawerStackAction = 'push' | 'pop' | null;

export interface DrawerStackContextValue {
  stack: DrawerEntry[];
  lastAction: DrawerStackAction;
  /** 入栈一层。栈内已存在相同 (type, id) 时，截断回该层并同步回退浏览器 history。 */
  push: (entry: Omit<DrawerEntry, 'key'>) => void;
  /** 弹出栈顶一层；空栈 noop。同步触发 history.back() 让浏览器历史一致。 */
  pop: () => void;
  /** 清空整栈；history 也回退 stack.length 步。 */
  clear: () => void;
  /**
   * 上层 view 注册「自己变回栈顶 / 栈被清空时」的回调（如 RelatedEntityList refetch）。
   * - entryKey: 监听该 entry 重新成为栈顶时触发；空字符串表示「栈被 pop 到空（回 root）」
   * - 同一 entryKey 可注册多个 cb（每次返回独立的反注册函数）
   */
  registerOnPopBack: (entryKey: string, cb: () => void) => () => void;
  /**
   * 二级抽屉在同层切换（view↔edit）保存成功后，需要通知上层关联列表（RelatedEntityList）刷新。
   * 由于保存不触发 pop，无法走 registerOnPopBack，所以单设一条事件总线。
   * 删除场景虽然会 pop（已走 registerOnPopBack），但为了一致性也建议保存/删除/创建都调用本方法。
   */
  notifyEntityChanged: (entityType: DrawerEntityType) => void;
  /**
   * RelatedEntityList 等订阅者监听数据变更事件。cb 接到事件后自行判断 entityType 是否匹配并 refetch。
   * 返回反注册函数。
   */
  registerEntityChanged: (cb: (entityType: DrawerEntityType) => void) => () => void;
}

const DrawerStackContext = createContext<DrawerStackContextValue | null>(null);

/** 在 Provider 内必返回 value。 */
// eslint-disable-next-line react-refresh/only-export-components -- hook 与 DrawerStackProvider 紧耦合，拆文件得不偿失
export function useDrawerStack(): DrawerStackContextValue {
  const ctx = useContext(DrawerStackContext);
  if (!ctx) {
    throw new Error('useDrawerStack must be used within DrawerStackProvider');
  }
  return ctx;
}

/**
 * 容忍式版本：不在 Provider 内时返回 null。RelatedEntityList 在独立列表页（无栈环境）下用这个。
 */
// eslint-disable-next-line react-refresh/only-export-components -- hook 与 DrawerStackProvider 紧耦合，拆文件得不偿失
export function useDrawerStackOptional(): DrawerStackContextValue | null {
  return useContext(DrawerStackContext);
}

const HISTORY_MARKER_KEY = '__drawerStack';

interface DrawerStackProviderProps {
  children: ReactNode;
}

interface OnPopBackEntry {
  entryKey: string;
  cb: () => void;
}

/**
 * History 同步策略（v2）：
 * - push 时 `history.pushState({...state, __drawerStack: depth})` 占位。
 * - 重复 push 同 (type, id) → 截断 + 同步 `history.go(-popCount)` + 更新 entry.title。
 * - pop()（程序触发）→ `history.back()` → popstate handler 校验 marker level 后弹栈。
 * - clear() → setStack([]) + `history.go(-n)` + `pendingProgrammaticPopRef += n`。
 * - popstate handler 优先看 `event.state?.__drawerStack`，能正确处理用户连按返回多次的情况。
 * - 路由切换 → setStack([]) + replaceState 清当前 entry 的 marker。
 *
 * onPopBack 时序：
 * - 不在 popstate/setStack 里同步触发（会跟新栈顶 view 的 useEffect 注册 race），
 *   而是用单独 useEffect 监听 stack 缩短，commit 后才触发——此时新栈顶 view 已挂载完毕。
 */
export function DrawerStackProvider({ children }: DrawerStackProviderProps) {
  const [stack, setStack] = useState<DrawerEntry[]>([]);
  const [lastAction, setLastAction] = useState<DrawerStackAction>(null);
  const stackRef = useRef<DrawerEntry[]>(stack);
  stackRef.current = stack;

  const keyCounterRef = useRef(0);
  /** instanceId → {entryKey, cb}；同一 entryKey 可有多个 instanceId */
  const onPopBackMapRef = useRef<Map<string, OnPopBackEntry>>(new Map());
  const onPopBackIdCounterRef = useRef(0);
  const pendingProgrammaticPopRef = useRef(0);
  /** 实体变更事件订阅者；保存/删除成功后由 detail view 调 notifyEntityChanged */
  const entityChangedSubscribersRef = useRef<Set<(entityType: DrawerEntityType) => void>>(
    new Set()
  );
  const location = useLocation();
  const lastPathnameRef = useRef(location.pathname);
  /** 上次渲染的 stack，useEffect 内对比触发 onPopBack */
  const prevStackForCallbackRef = useRef<DrawerEntry[]>(stack);

  const push = useCallback((entry: Omit<DrawerEntry, 'key'>) => {
    setStack((prev) => {
      const mode: DrawerEntryMode = entry.mode ?? 'detail';
      // detail 模式重复 push 同 (type, id) → 截断回已有层 + 同步回退 history 多余 marker。
      // create 模式不去重：每次新增按钮点击都视为新建一层。
      if (mode === 'detail') {
        const existingIdx = prev.findIndex(
          (e) => (e.mode ?? 'detail') === 'detail' && e.type === entry.type && e.id === entry.id
        );
        if (existingIdx !== -1) {
          const popCount = prev.length - existingIdx - 1;
          if (popCount > 0 && typeof window !== 'undefined') {
            pendingProgrammaticPopRef.current += popCount;
            window.history.go(-popCount);
          }
          const truncated = prev.slice(0, existingIdx + 1);
          const existing = truncated[existingIdx];
          if (existing && (entry.title || entry.context)) {
            truncated[existingIdx] = {
              ...existing,
              title: entry.title ?? existing.title,
              context: entry.context ?? existing.context,
            };
          }
          setLastAction(popCount > 0 ? 'pop' : 'push');
          return truncated;
        }
      }
      keyCounterRef.current += 1;
      const newEntry: DrawerEntry = { ...entry, mode, key: `drawer-${keyCounterRef.current}` };
      if (typeof window !== 'undefined') {
        const currentState = (window.history.state ?? {}) as Record<string, unknown>;
        window.history.pushState(
          { ...currentState, [HISTORY_MARKER_KEY]: prev.length + 1 },
          '',
          window.location.href
        );
      }
      setLastAction('push');
      return [...prev, newEntry];
    });
  }, []);

  const pop = useCallback(() => {
    if (stackRef.current.length === 0) return;
    if (typeof window !== 'undefined') {
      window.history.back();
    } else {
      setStack((prev) => {
        if (prev.length === 0) return prev;
        setLastAction('pop');
        return prev.slice(0, -1);
      });
    }
  }, []);

  const clear = useCallback(() => {
    const n = stackRef.current.length;
    if (n === 0) return;
    setStack([]);
    setLastAction('pop');
    if (typeof window !== 'undefined') {
      pendingProgrammaticPopRef.current += n;
      window.history.go(-n);
    }
  }, []);

  const registerOnPopBack = useCallback((entryKey: string, cb: () => void) => {
    onPopBackIdCounterRef.current += 1;
    const id = `cb-${onPopBackIdCounterRef.current}`;
    onPopBackMapRef.current.set(id, { entryKey, cb });
    return () => {
      onPopBackMapRef.current.delete(id);
    };
  }, []);

  const notifyEntityChanged = useCallback((entityType: DrawerEntityType) => {
    for (const cb of entityChangedSubscribersRef.current) {
      try {
        cb(entityType);
      } catch {
        /* swallow */
      }
    }
  }, []);

  const registerEntityChanged = useCallback((cb: (entityType: DrawerEntityType) => void) => {
    entityChangedSubscribersRef.current.add(cb);
    return () => {
      entityChangedSubscribersRef.current.delete(cb);
    };
  }, []);

  // popstate：浏览器返回键 / pop()/clear() 都会走这里
  useEffect(() => {
    const handlePopState = (e: PopStateEvent) => {
      if (pendingProgrammaticPopRef.current > 0) {
        pendingProgrammaticPopRef.current -= 1;
        return;
      }
      if (stackRef.current.length === 0) return;

      const targetLevel =
        ((e.state as { [k: string]: unknown } | null)?.[HISTORY_MARKER_KEY] as
          | number
          | undefined) ?? 0;
      const currentLevel = stackRef.current.length;
      if (targetLevel >= currentLevel) {
        // 用户按了「前进」回到深层 marker，但栈状态我们没存 → 跳过（P2 缺陷，下版优化）
        return;
      }
      const popCount = currentLevel - targetLevel;
      setStack((prev) => prev.slice(0, prev.length - popCount));
      setLastAction('pop');
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  // 监听 stack 缩短 → commit 后触发 onPopBack（此时新栈顶 view 已挂载并注册了自己的 cb）
  useEffect(() => {
    const prev = prevStackForCallbackRef.current;
    prevStackForCallbackRef.current = stack;
    if (stack.length >= prev.length) return; // 入栈/不变跳过

    // 触发新栈顶（pop 后变成栈顶的 entry）的所有 cb
    // 栈空时触发 entryKey='' 的所有 cb（root 监听者，如客户抽屉里的 RelatedEntityList）
    const newTop = stack[stack.length - 1];
    const targetKey = newTop?.key ?? '';
    for (const { entryKey, cb } of onPopBackMapRef.current.values()) {
      if (entryKey === targetKey) {
        try {
          cb();
        } catch {
          /* swallow: cb 异常不影响其他 cb */
        }
      }
    }
  }, [stack]);

  // 路由切换：清栈 + 清当前 entry marker（不动旧 history 的 marker，靠 popstate handler stack=0 跳过）
  useEffect(() => {
    if (location.pathname !== lastPathnameRef.current) {
      lastPathnameRef.current = location.pathname;
      if (stackRef.current.length > 0) {
        setStack([]);
        setLastAction(null);
        onPopBackMapRef.current.clear();
        if (typeof window !== 'undefined') {
          const currentState = (window.history.state ?? {}) as Record<string, unknown>;
          if (HISTORY_MARKER_KEY in currentState) {
            const { [HISTORY_MARKER_KEY]: _omit, ...rest } = currentState;
            void _omit;
            window.history.replaceState(rest, '', window.location.href);
          }
        }
      }
    }
  }, [location.pathname]);

  const value = useMemo<DrawerStackContextValue>(
    () => ({
      stack,
      lastAction,
      push,
      pop,
      clear,
      registerOnPopBack,
      notifyEntityChanged,
      registerEntityChanged,
    }),
    [
      stack,
      lastAction,
      push,
      pop,
      clear,
      registerOnPopBack,
      notifyEntityChanged,
      registerEntityChanged,
    ]
  );

  return (
    <DrawerStackContext.Provider value={value}>
      <HeaderActionsProvider>
        <BeforeCloseGuardProvider>{children}</BeforeCloseGuardProvider>
      </HeaderActionsProvider>
    </DrawerStackContext.Provider>
  );
}
