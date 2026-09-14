import { AlertTriangle, RefreshCw } from 'lucide-react';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';

import type { AnalyticsQueryState } from './analytics-query-state';

export function AnalyticsQueryStatus({ queries }: { queries: AnalyticsQueryState[] }) {
  const failed = queries.filter((query) => query.isError);
  if (failed.length === 0) return null;

  const hasStaleData = failed.some((query) => query.hasData);
  const retrying = failed.some((query) => query.isFetching);

  return (
    <Alert variant="warning">
      <AlertTriangle className="h-4 w-4" />
      <AlertTitle>
        {failed.length === queries.length ? '数据加载失败' : '部分数据加载失败'}
      </AlertTitle>
      <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
        <span>
          {failed.map((query) => query.label).join('、')}获取失败。
          {hasStaleData
            ? '已有区域保留上次成功数据，当前不是最新结果。'
            : '失败区域不代表业务数据为零。'}
        </span>
        <Button
          type="button"
          size="sm"
          variant="outline"
          loading={retrying}
          onClick={() => void Promise.all(failed.map((query) => query.refetch()))}
        >
          <RefreshCw className="mr-1 h-3.5 w-3.5" />
          重新加载失败数据
        </Button>
      </AlertDescription>
    </Alert>
  );
}
