import * as React from 'react';

import { cn } from '@/lib/utils';

// Tabs 上下文
interface TabsContextValue {
  value: string;
  onValueChange: (value: string) => void;
}

const TabsContext = React.createContext<TabsContextValue | null>(null);

function useTabsContext() {
  const context = React.useContext(TabsContext);
  if (!context) {
    throw new Error('Tabs components must be used within a Tabs provider');
  }
  return context;
}

// Tabs 根组件
interface TabsProps {
  value: string;
  onValueChange: (value: string) => void;
  className?: string;
  children: React.ReactNode;
}

export function Tabs({ value, onValueChange, className, children }: TabsProps) {
  return (
    <TabsContext.Provider value={{ value, onValueChange }}>
      <div className={cn('', className)} data-testid="tabs">
        {children}
      </div>
    </TabsContext.Provider>
  );
}

// 标签列表容器
interface TabsListProps {
  className?: string;
  children: React.ReactNode;
}

export function TabsList({ className, children }: TabsListProps) {
  return (
    <div
      className={cn(
        'inline-flex h-10 items-center justify-center rounded-md bg-muted p-1 text-muted-foreground',
        className
      )}
      role="tablist"
      data-testid="tabs-list"
    >
      {children}
    </div>
  );
}

// 单个标签触发器
interface TabsTriggerProps {
  value: string;
  className?: string;
  children: React.ReactNode;
  disabled?: boolean;
}

export function TabsTrigger({ value, className, children, disabled }: TabsTriggerProps) {
  const { value: selectedValue, onValueChange } = useTabsContext();
  const isSelected = selectedValue === value;

  return (
    <button
      type="button"
      role="tab"
      aria-selected={isSelected}
      disabled={disabled}
      onClick={() => !disabled && onValueChange(value)}
      className={cn(
        'inline-flex items-center justify-center whitespace-nowrap rounded-sm px-3 py-1.5 text-sm font-medium ring-offset-background transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50',
        isSelected
          ? 'bg-background text-foreground shadow-sm active:bg-background/90'
          : 'hover:bg-background/50 hover:text-foreground active:bg-background/70',
        className
      )}
      data-testid={`tab-${value}`}
      data-state={isSelected ? 'active' : 'inactive'}
    >
      {children}
    </button>
  );
}

// 标签内容面板
interface TabsContentProps {
  value: string;
  className?: string;
  children: React.ReactNode;
  /** 始终挂载内容，即使非活跃状态也不卸载 */
  forceMount?: boolean;
}

export function TabsContent({ value, className, children, forceMount }: TabsContentProps) {
  const { value: selectedValue } = useTabsContext();
  const isSelected = selectedValue === value;

  if (!forceMount && !isSelected) {
    return null;
  }

  return (
    <div
      role="tabpanel"
      className={cn(
        'mt-2 ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
        className
      )}
      data-testid={`tab-content-${value}`}
      data-state={isSelected ? 'active' : 'inactive'}
    >
      {children}
    </div>
  );
}
