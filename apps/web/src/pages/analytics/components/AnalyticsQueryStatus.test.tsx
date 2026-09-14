import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { toAnalyticsQueryState } from './analytics-query-state';
import { AnalyticsQueryStatus } from './AnalyticsQueryStatus';

describe('AnalyticsQueryStatus', () => {
  it('从查询结果保留旧快照标记和原 refetch', () => {
    const refetch = vi.fn(async () => undefined);
    expect(
      toAnalyticsQueryState('经营总览', {
        isError: true,
        isFetching: false,
        data: { cached: true },
        refetch,
      })
    ).toEqual({
      label: '经营总览',
      isError: true,
      isFetching: false,
      hasData: true,
      refetch,
    });
  });

  it('明确区分失败与业务零值，并只重试失败查询', () => {
    const failedRefetch = vi.fn(async () => undefined);
    const healthyRefetch = vi.fn(async () => undefined);
    render(
      <AnalyticsQueryStatus
        queries={[
          {
            label: '核心指标',
            isError: true,
            isFetching: false,
            hasData: false,
            refetch: failedRefetch,
          },
          {
            label: '趋势',
            isError: false,
            isFetching: false,
            hasData: true,
            refetch: healthyRefetch,
          },
        ]}
      />
    );

    expect(screen.getByText('部分数据加载失败')).not.toBeNull();
    expect(screen.getByText(/失败区域不代表业务数据为零/)).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /重新加载失败数据/ }));
    expect(failedRefetch).toHaveBeenCalledOnce();
    expect(healthyRefetch).not.toHaveBeenCalled();
  });

  it('有旧快照时明确标为非最新结果', () => {
    render(
      <AnalyticsQueryStatus
        queries={[
          {
            label: '经营总览',
            isError: true,
            isFetching: false,
            hasData: true,
            refetch: async () => undefined,
          },
        ]}
      />
    );
    expect(screen.getByText(/当前不是最新结果/)).not.toBeNull();
  });
});
