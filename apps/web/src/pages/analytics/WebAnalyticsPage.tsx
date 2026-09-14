import { RotateCcw } from 'lucide-react';
import { useMemo } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { MultiSelect, Select } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { AnalyticsDateRangePicker } from '@/pages/analytics/components/AnalyticsDateRangePicker';
import {
  optionLabel,
  toEventOptions,
  toOptions,
  type WebAnalyticsSiteOption,
} from '@/pages/analytics/components/web-analytics-presenters';
import { WebAnalyticsActiveSection } from '@/pages/analytics/components/WebAnalyticsSections';
import {
  useWebAnalyticsDashboardState,
  type WebAnalyticsSection,
} from '@/pages/analytics/hooks/use-web-analytics-dashboard-state';
import { useWebAnalyticsFilterOptions } from '@/pages/analytics/hooks/use-web-analytics-data';

export default function WebAnalyticsPage() {
  const dashboard = useWebAnalyticsDashboardState();
  const {
    range,
    setRange,
    resolvedRange,
    filters,
    effectiveFilters,
    pathInput,
    setPathInput,
    hasFilters,
    updateFilter,
    clearFilters,
    section,
    setSection,
  } = dashboard;
  const options = useWebAnalyticsFilterOptions(range, effectiveFilters);

  const siteOptions: WebAnalyticsSiteOption[] = useMemo(() => {
    const raw = options.data?.sites ?? [];
    const values = new Set(raw.map((item) => item.value));
    const merged =
      filters.site && !values.has(filters.site)
        ? [{ value: filters.site, label: filters.site, count: 0 }, ...raw]
        : raw;
    return [
      { value: null, label: '全部站点' },
      ...merged.map((item) => ({ value: item.value, label: optionLabel(item.label, item.count) })),
    ];
  }, [filters.site, options.data?.sites]);

  return (
    <div className="h-full space-y-6 overflow-auto p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">官网增长驾驶舱</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            数据范围：{resolvedRange.startDate} ~ {resolvedRange.endDate}
          </p>
        </div>
        <AnalyticsDateRangePicker value={range} onChange={setRange} />
      </div>

      <Tabs value={section} onValueChange={(value) => setSection(value as WebAnalyticsSection)}>
        <TabsList className="h-auto flex-wrap justify-start gap-1">
          <TabsTrigger value="overview">总览</TabsTrigger>
          <TabsTrigger value="acquisition">获客</TabsTrigger>
          <TabsTrigger value="content">内容</TabsTrigger>
          <TabsTrigger value="conversion">转化</TabsTrigger>
          <TabsTrigger value="visitors">访客</TabsTrigger>
          <TabsTrigger value="health">数据健康</TabsTrigger>
        </TabsList>
      </Tabs>

      <div className="rounded-md border bg-card p-4">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <Select
            options={siteOptions}
            value={filters.site ?? null}
            onChange={(value) => updateFilter('site', value)}
            placeholder="全部站点"
            className="h-9"
            contentClassName="min-w-[220px]"
          />
          <MultiSelect
            options={toEventOptions(options.data?.events, filters.events)}
            value={filters.events ?? []}
            onChange={(value) => updateFilter('events', value)}
            placeholder="事件"
            className="h-9"
          />
          <MultiSelect
            options={toOptions(options.data?.pageTypes, filters.pageTypes)}
            value={filters.pageTypes ?? []}
            onChange={(value) => updateFilter('pageTypes', value)}
            placeholder="页面类型"
            className="h-9"
          />
          <Input
            value={pathInput}
            onChange={(event) => setPathInput(event.target.value)}
            placeholder="搜索路径"
            className="h-9"
          />
          <MultiSelect
            options={toOptions(options.data?.utmSources, filters.utmSources)}
            value={filters.utmSources ?? []}
            onChange={(value) => updateFilter('utmSources', value)}
            placeholder="UTM 来源"
            className="h-9"
          />
          <MultiSelect
            options={toOptions(options.data?.refHosts, filters.refHosts)}
            value={filters.refHosts ?? []}
            onChange={(value) => updateFilter('refHosts', value)}
            placeholder="来源域名"
            className="h-9"
          />
          <MultiSelect
            options={toOptions(options.data?.placements, filters.placements)}
            value={filters.placements ?? []}
            onChange={(value) => updateFilter('placements', value)}
            placeholder="咨询位置"
            className="h-9"
          />
          <MultiSelect
            options={toOptions(options.data?.channels, filters.channels)}
            value={filters.channels ?? []}
            onChange={(value) => updateFilter('channels', value)}
            placeholder="咨询渠道"
            className="h-9"
          />
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Switch
              id="include-bots"
              checked={Boolean(filters.includeBots)}
              onCheckedChange={(checked) => updateFilter('includeBots', checked)}
            />
            <Label htmlFor="include-bots" className="text-sm text-muted-foreground">
              包含已识别自动化流量
            </Label>
          </div>
          {hasFilters && (
            <Button variant="ghost" size="sm" onClick={clearFilters} className="gap-2">
              <RotateCcw className="h-4 w-4" />
              清空筛选
            </Button>
          )}
        </div>
      </div>

      <WebAnalyticsActiveSection dashboard={dashboard} />
    </div>
  );
}
