import { cn } from '@/lib/utils';

import type { FilterSchemeSummaryWithDirty } from '../types';

export interface PageKeyListProps {
  items: FilterSchemeSummaryWithDirty[];
  selectedPageKey: string | null;
  onSelect: (pageKey: string) => void;
  onResetAll?: () => void;
}

export function PageKeyList({ items, selectedPageKey, onSelect, onResetAll }: PageKeyListProps) {
  return (
    <aside className="flex h-full w-72 shrink-0 flex-col overflow-hidden rounded-lg border bg-card">
      <div className="shrink-0 border-b px-4 py-3">
        <h3 className="text-sm font-medium text-foreground">已注册页面</h3>
        <p className="text-xs text-muted-foreground">共 {items.length} 个</p>
      </div>
      <ul className="min-h-0 flex-1 overflow-auto p-2">
        {items.length === 0 ? (
          <li className="px-2 py-6 text-center text-sm text-muted-foreground">
            尚未注册任何筛选方案
          </li>
        ) : (
          items.map((item) => {
            const isActive = item.pageKey === selectedPageKey;
            return (
              <li key={item.pageKey}>
                <button
                  type="button"
                  onClick={() => onSelect(item.pageKey)}
                  className={cn(
                    'flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm transition-colors',
                    isActive ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/50'
                  )}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate font-medium">{item.pageName ?? item.pageKey}</span>
                      {item.dirty ? <span className="text-amber-500">●</span> : null}
                    </div>
                    <div className="mt-0.5 truncate text-xs text-muted-foreground">
                      {item.pageKey}
                    </div>
                    <div className="mt-0.5 text-xs text-muted-foreground">
                      {item.activeFieldCount}/{item.fieldCount} 字段 · v{item.version}
                    </div>
                  </div>
                </button>
              </li>
            );
          })
        )}
      </ul>
      {onResetAll ? (
        <div className="shrink-0 border-t p-2">
          <button
            type="button"
            onClick={onResetAll}
            className="w-full rounded-md px-3 py-2 text-xs text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground"
          >
            恢复全部默认
          </button>
        </div>
      ) : null}
    </aside>
  );
}
