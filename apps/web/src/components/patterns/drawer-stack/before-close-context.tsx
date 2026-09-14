import { createContext, type ReactNode, useCallback, useContext, useMemo, useRef } from 'react';

/**
 * Before-close guard：栈顶 detail view 在进入编辑模式且字段已修改时，
 * 注册一个 canProceed 回调，让 DrawerStackHost 在 ESC/X/返回/遮罩点击时先询问。
 *
 * canProceed 返回 true 表示放行；false 表示阻止本次关闭。
 *
 * 实现选型：用 ref 而非 state，避免 detail view 注册/反注册时触发 Host 重渲染。
 * 同一时刻只允许一个 guard（栈顶 view 才有发言权；新栈层 push 时旧 guard 不再有效）。
 */
type CanProceedFn = () => boolean | Promise<boolean>;

interface BeforeCloseContextValue {
  setGuard: (fn: CanProceedFn | null) => void;
  /** DrawerStackHost 内部用：检查是否可以关闭/pop。 */
  runGuard: () => Promise<boolean>;
}

const BeforeCloseContext = createContext<BeforeCloseContextValue | null>(null);

interface BeforeCloseGuardProviderProps {
  children: ReactNode;
}

export function BeforeCloseGuardProvider({ children }: BeforeCloseGuardProviderProps) {
  const guardRef = useRef<CanProceedFn | null>(null);

  const setGuard = useCallback((fn: CanProceedFn | null) => {
    guardRef.current = fn;
  }, []);

  const runGuard = useCallback(async () => {
    const fn = guardRef.current;
    if (!fn) return true;
    try {
      const result = await fn();
      return result !== false;
    } catch {
      return true;
    }
  }, []);

  const value = useMemo<BeforeCloseContextValue>(
    () => ({ setGuard, runGuard }),
    [setGuard, runGuard]
  );

  return <BeforeCloseContext.Provider value={value}>{children}</BeforeCloseContext.Provider>;
}

/**
 * 供 detail view 注册自己的「关闭前检查」逻辑。
 */
// eslint-disable-next-line react-refresh/only-export-components -- hook 与 Provider 紧耦合
export function useSetBeforeCloseGuard(): (fn: CanProceedFn | null) => void {
  const ctx = useContext(BeforeCloseContext);
  if (!ctx) {
    throw new Error('useSetBeforeCloseGuard must be used within BeforeCloseGuardProvider');
  }
  return ctx.setGuard;
}

/**
 * 供 DrawerStackHost 在关闭入口处调用，统一询问当前栈顶 guard。
 */
// eslint-disable-next-line react-refresh/only-export-components -- 同上
export function useBeforeCloseRunner(): () => Promise<boolean> {
  const ctx = useContext(BeforeCloseContext);
  if (!ctx) {
    throw new Error('useBeforeCloseRunner must be used within BeforeCloseGuardProvider');
  }
  return ctx.runGuard;
}
