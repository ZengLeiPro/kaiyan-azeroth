import { Skeleton } from '@/components/ui/skeleton';

export interface FilterBarSkeletonProps {
  /** 占位字段数量（默认 4 个） */
  count?: number;
  /** 每个占位的宽度（Tailwind class，默认 w-32） */
  width?: string;
}

/**
 * 筛选栏加载占位。
 *
 * 与 `CrudFilterBar` 的外层一致使用 `flex flex-wrap items-center gap-4`，
 * 保证 useFilterScheme loading -> ready 切换时，toolbar 高度不会跳变。
 */
export function FilterBarSkeleton({ count = 4, width = 'w-32' }: FilterBarSkeletonProps) {
  return (
    <div className="flex flex-wrap items-center gap-4" data-testid="filter-bar-skeleton">
      {Array.from({ length: count }).map((_, idx) => (
        <Skeleton key={idx} className={`h-9 ${width}`} />
      ))}
    </div>
  );
}
