import type { WebAnalyticsBreakdownDimension } from '@ky-azeroth/shared/constants';
import { useMemo, useState } from 'react';

import { useDebouncedValue } from '@/hooks/use-debounced-value';
import type { AnalyticsRangeValue } from '@/pages/analytics/components/AnalyticsDateRangePicker';

import { resolveSeoRange } from './use-seo-analytics-data';
import type { WebAnalyticsFilters } from './use-web-analytics-data';

export type WebAnalyticsSection =
  | 'overview'
  | 'acquisition'
  | 'content'
  | 'conversion'
  | 'visitors'
  | 'health';

export type WebAnalyticsTrendMetric = 'pv' | 'uv' | 'sessions' | 'leads';
export type WebAnalyticsPageScope = 'all' | 'blog';
export type WebAnalyticsEntryDimension = 'placement' | 'channel';

export function useWebAnalyticsDashboardState() {
  const [range, setRange] = useState<AnalyticsRangeValue>({ preset: 'last30d' });
  const [filters, setFilters] = useState<WebAnalyticsFilters>({});
  const [pathInput, setPathInputState] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSizeState] = useState(30);
  const [section, setSection] = useState<WebAnalyticsSection>('overview');
  const [trendMetric, setTrendMetric] = useState<WebAnalyticsTrendMetric>('pv');
  const [sourceDim, setSourceDim] = useState<WebAnalyticsBreakdownDimension>('search_engine');
  const [pageScope, setPageScope] = useState<WebAnalyticsPageScope>('all');
  const [entryDim, setEntryDim] = useState<WebAnalyticsEntryDimension>('placement');
  const [vidDetail, setVidDetail] = useState<string | null>(null);

  const debouncedPath = useDebouncedValue(pathInput.trim(), 300);
  const effectiveFilters = useMemo<WebAnalyticsFilters>(
    () => ({ ...filters, pathSearch: debouncedPath || undefined }),
    [filters, debouncedPath]
  );
  const resolvedRange = useMemo(() => resolveSeoRange(range), [range]);
  const pageRankFilters = useMemo<WebAnalyticsFilters>(
    () =>
      pageScope === 'blog'
        ? { ...effectiveFilters, events: ['pageview'], pageTypes: ['blog_post'] }
        : { ...effectiveFilters, events: ['pageview'] },
    [effectiveFilters, pageScope]
  );

  const hasFilters =
    Boolean(filters.site) ||
    Boolean(filters.includeBots) ||
    Boolean(pathInput.trim()) ||
    Boolean(filters.events?.length) ||
    Boolean(filters.pageTypes?.length) ||
    Boolean(filters.utmSources?.length) ||
    Boolean(filters.refHosts?.length) ||
    Boolean(filters.placements?.length) ||
    Boolean(filters.channels?.length);

  const updateFilter = <K extends keyof WebAnalyticsFilters>(
    key: K,
    value: WebAnalyticsFilters[K]
  ) => {
    setFilters((previous) => ({ ...previous, [key]: value }));
    setPage(1);
  };

  const setPathInput = (value: string) => {
    setPathInputState(value);
    setPage(1);
  };

  const setDashboardRange = (value: AnalyticsRangeValue) => {
    setRange(value);
    setPage(1);
  };

  const setPageSize = (value: number) => {
    setPageSizeState(value);
    setPage(1);
  };

  const clearFilters = () => {
    setFilters({});
    setPathInputState('');
    setPage(1);
  };

  return {
    range,
    setRange: setDashboardRange,
    resolvedRange,
    filters,
    effectiveFilters,
    pageRankFilters,
    pathInput,
    setPathInput,
    hasFilters,
    updateFilter,
    clearFilters,
    page,
    setPage,
    pageSize,
    setPageSize,
    section,
    setSection,
    trendMetric,
    setTrendMetric,
    sourceDim,
    setSourceDim,
    pageScope,
    setPageScope,
    entryDim,
    setEntryDim,
    vidDetail,
    setVidDetail,
  };
}

export type WebAnalyticsDashboardState = ReturnType<typeof useWebAnalyticsDashboardState>;
