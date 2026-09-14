import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from 'react';

/**
 * 当前栈顶 detail view 注入到 DrawerStackHost Header 的 actions 节点。
 *
 * 设计要点：
 * - detail view 内部状态（mode/saving/dirty）只能在组件内访问，把 actions 上推到 Header 必须经 React。
 * - 用 Context + useState 而不是给 DrawerEntry 加 actions 字段：后者每次 setActions 都要 updateEntry，
 *   连续 push/pop 时 key 变化会出现 race。
 * - cleanup（useEffect 卸载时调 setActions(null)）由调用方保证，确保栈层切换时旧 actions 不残留。
 */
interface HeaderActionsContextValue {
  actions: ReactNode | null;
  setActions: (node: ReactNode | null) => void;
}

const HeaderActionsContext = createContext<HeaderActionsContextValue | null>(null);

interface HeaderActionsProviderProps {
  children: ReactNode;
}

export function HeaderActionsProvider({ children }: HeaderActionsProviderProps) {
  const [actions, setActionsState] = useState<ReactNode | null>(null);

  const setActions = useCallback((node: ReactNode | null) => {
    setActionsState(node);
  }, []);

  const value = useMemo<HeaderActionsContextValue>(
    () => ({ actions, setActions }),
    [actions, setActions]
  );

  return <HeaderActionsContext.Provider value={value}>{children}</HeaderActionsContext.Provider>;
}

/**
 * 供 DrawerStackHost 读当前 actions 并渲染到 Header。
 */
// eslint-disable-next-line react-refresh/only-export-components -- hook 与 Provider 紧耦合，拆文件得不偿失
export function useHeaderActionsHost(): HeaderActionsContextValue {
  const ctx = useContext(HeaderActionsContext);
  if (!ctx) {
    throw new Error('useHeaderActionsHost must be used within HeaderActionsProvider');
  }
  return ctx;
}

/**
 * 供 detail view 调用：注册自己想显示在 Header 的 actions。
 * 仅返回 setActions 函数，detail view 在 useEffect 内调用，卸载时传 null 清理。
 */
// eslint-disable-next-line react-refresh/only-export-components -- 同上
export function useSetDrawerHeaderActions(): (node: ReactNode | null) => void {
  const ctx = useContext(HeaderActionsContext);
  if (!ctx) {
    throw new Error('useSetDrawerHeaderActions must be used within HeaderActionsProvider');
  }
  return ctx.setActions;
}
