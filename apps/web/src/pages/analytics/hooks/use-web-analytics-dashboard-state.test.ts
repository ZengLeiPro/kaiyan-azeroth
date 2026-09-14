import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useWebAnalyticsDashboardState } from './use-web-analytics-dashboard-state';

describe('useWebAnalyticsDashboardState', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('统一维护筛选、路径防抖，并在筛选变化时重置分页', () => {
    const { result } = renderHook(() => useWebAnalyticsDashboardState());

    act(() => {
      result.current.setPage(4);
      result.current.updateFilter('site', 'example.com');
      result.current.setPathInput('  /blog/agent  ');
    });

    expect(result.current.page).toBe(1);
    expect(result.current.filters).toEqual({ site: 'example.com' });
    expect(result.current.effectiveFilters.pathSearch).toBeUndefined();
    expect(result.current.hasFilters).toBe(true);

    act(() => {
      vi.advanceTimersByTime(300);
    });

    expect(result.current.effectiveFilters).toEqual({
      site: 'example.com',
      pathSearch: '/blog/agent',
    });

    act(() => {
      result.current.clearFilters();
    });

    expect(result.current.filters).toEqual({});
    expect(result.current.pathInput).toBe('');
    expect(result.current.page).toBe(1);
  });

  it('统一维护范围、分页和 section，并生成热门页面的既有筛选 contract', () => {
    const { result } = renderHook(() => useWebAnalyticsDashboardState());

    act(() => {
      result.current.setPage(5);
      result.current.setPageSize(100);
      result.current.setRange({
        preset: 'custom',
        startDate: '2026-08-01',
        endDate: '2026-08-20',
      });
      result.current.setSection('acquisition');
      result.current.updateFilter('utmSources', ['baidu']);
      result.current.setPageScope('blog');
    });

    expect(result.current.page).toBe(1);
    expect(result.current.pageSize).toBe(100);
    expect(result.current.section).toBe('acquisition');
    expect(result.current.range).toEqual({
      preset: 'custom',
      startDate: '2026-08-01',
      endDate: '2026-08-20',
    });
    expect(result.current.pageRankFilters).toEqual({
      utmSources: ['baidu'],
      pathSearch: undefined,
      events: ['pageview'],
      pageTypes: ['blog_post'],
    });
  });
});
