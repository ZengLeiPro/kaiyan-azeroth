import { useMemo, useState } from 'react';

import { CrudFilterBar } from '@/components/patterns/crud-filter-bar';
import { FilterBarSkeleton } from '@/components/patterns/filter-bar-skeleton';
import { HeaderRight } from '@/components/patterns/header-right';
import { StandardToolbar } from '@/components/patterns/standard-toolbar';
import { StandardLayout } from '@/components/templates/standard-layout';
import { Card, CardContent } from '@/components/ui/card';
import { SegmentedToggle } from '@/components/ui/segmented-toggle';
import { useFilterScheme } from '@/hooks/use-filter-scheme';
import { type FilterValue, useManualFilter } from '@/hooks/use-manual-filter';
import { useIsMobile } from '@/hooks/use-mobile';
import { cn } from '@/lib/utils';

import { CompletionCheck } from './components/CompletionCheck';
import { PersonStats } from './components/PersonStats';
import { ProjectStats } from './components/ProjectStats';
import { useEffortStats } from './hooks/use-effort-stats';
import type { StatsFilter } from './types';

// CrudFilterBar 字段 state 的 key:与 useFilterScheme 注入的 bracket key 对齐
const WORK_DATE_FROM_KEY = 'filters[workDate][from]';
const WORK_DATE_TO_KEY = 'filters[workDate][to]';
const OWNER_ID_KEY = 'filters[ownerId][]';
const PROJECT_ID_KEY = 'filters[projectId][]';

/**
 * 工时填报相关角色:「记录人」筛选器只展示这两种角色的员工。
 * 与后端 effort-stats.service.ts EFFORT_FILLING_ROLE_CODES 保持一致 ——
 * 销售/财务/行政等不参与工时填报,纳入会让「未填」噪声盖过真实开发交付盘。
 */
const EFFORT_FILLING_ROLE_CODES = ['PM', 'DEVELOPER'];

function formatLocalDate(d: Date): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * 计算"默认日期范围":周一 18:00 之前显示上周(方便周会回顾),
 * 否则显示本周一到今天。
 */
function getDefaultDateRange(): { from: string; to: string } {
  const now = new Date();
  const day = now.getDay(); // 0=Sun,1=Mon,...,6=Sat
  const offsetToMonday = day === 0 ? -6 : 1 - day;
  const thisMonday = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offsetToMonday);

  const isEarlyMonday = day === 1 && now.getHours() < 18;
  if (isEarlyMonday) {
    const lastMonday = new Date(thisMonday);
    lastMonday.setDate(lastMonday.getDate() - 7);
    const lastSunday = new Date(thisMonday);
    lastSunday.setDate(lastSunday.getDate() - 1);
    return {
      from: formatLocalDate(lastMonday),
      to: formatLocalDate(lastSunday),
    };
  }

  return {
    from: formatLocalDate(thisMonday),
    to: formatLocalDate(now),
  };
}

/**
 * 把 useManualFilter 收集到的 bracket key state 转换成 stats endpoint 期望的
 * 扁平参数。这是关键的"桥接函数":前端复用 filter-scheme 的 UI 渲染能力,
 * 后端 stats endpoint 不变,仍然吃扁平 `startDate/endDate/ownerId[]/projectId[]`。
 *
 * 这里返回的对象会成为 `useEffortStats` 的入参,并被 hook 的 queryKey 追踪 ——
 * 所以必须保证形态稳定(空数组 vs undefined 一致),否则会产生多余的请求。
 */
function toStatsFilter(state: Record<string, FilterValue>): StatsFilter {
  const startDate = (state[WORK_DATE_FROM_KEY] as string | undefined) ?? '';
  const endDate = (state[WORK_DATE_TO_KEY] as string | undefined) ?? '';
  const ownerRaw = state[OWNER_ID_KEY];
  const projectRaw = state[PROJECT_ID_KEY];

  return {
    startDate,
    endDate,
    ownerId: Array.isArray(ownerRaw) && ownerRaw.length > 0 ? ownerRaw : undefined,
    projectId: Array.isArray(projectRaw) && projectRaw.length > 0 ? projectRaw : undefined,
  };
}

type EffortStatsTab = 'person' | 'project' | 'completion';

export function EffortStatsPage() {
  const isMobile = useIsMobile();
  const [activeTab, setActiveTab] = useState<EffortStatsTab>('person');

  const scheme = useFilterScheme('projects.effort_stats');

  // 在 scheme 提供的 initialFilters 基础上注入"本周"默认日期,
  // 让页面首次加载就有数据展示(而不是空 startDate 触发 enabled=false)。
  const initialFiltersWithDefaults = useMemo(() => {
    if (scheme.isLoading || scheme.isFallback) return scheme.initialFilters;
    const defaults = getDefaultDateRange();
    return {
      ...scheme.initialFilters,
      [WORK_DATE_FROM_KEY]: defaults.from,
      [WORK_DATE_TO_KEY]: defaults.to,
    };
  }, [scheme.initialFilters, scheme.isLoading, scheme.isFallback]);

  const filter = useManualFilter(initialFiltersWithDefaults, undefined, scheme.version);

  // 把 activeFilters 转成 stats endpoint 期望的扁平参数
  const statsFilter = useMemo(
    () => toStatsFilter(filter.activeFilters as Record<string, FilterValue>),
    [filter.activeFilters]
  );

  const { isLoading, personStats, projectStats, completionCheck } = useEffortStats(statsFilter);

  // 把 PM/DEVELOPER 角色限制注入到「记录人」筛选项 ——
  // scheme registry 不感知角色概念(避免污染通用 entity 元数据),
  // 由本页面在消费 scheme.fields 时做最小侵入式覆写。
  const filterFields = useMemo(
    () =>
      scheme.fields.map((field) => {
        if (
          (field.kind === 'entitySelect' || field.kind === 'entityMultiSelect') &&
          field.entity === 'employee' &&
          field.key === OWNER_ID_KEY
        ) {
          return { ...field, roleCodes: EFFORT_FILLING_ROLE_CODES };
        }
        return field;
      }),
    [scheme.fields]
  );

  return (
    <StandardLayout
      toolbar={
        <StandardToolbar
          onSearch={filter.search}
          onReset={filter.reset}
          filters={
            scheme.isLoading ? (
              <FilterBarSkeleton count={3} />
            ) : (
              <CrudFilterBar
                fields={filterFields}
                values={filter.tempFilters}
                onChange={filter.setFilter}
                personalFilter={
                  scheme.registry && scheme.config && scheme.defaultConfig
                    ? {
                        pageKey: scheme.registry.pageKey,
                        registry: scheme.registry,
                        config: scheme.config,
                        defaultConfig: scheme.defaultConfig,
                        onApply: filter.replaceFilters,
                      }
                    : undefined
                }
              />
            )
          }
        />
      }
    >
      <HeaderRight>
        <SegmentedToggle<EffortStatsTab>
          value={activeTab}
          onChange={setActiveTab}
          options={[
            { value: 'person', label: '按人统计' },
            { value: 'project', label: '按项目统计' },
            { value: 'completion', label: '填报完整性' },
          ]}
          ariaLabel="统计维度"
        />
      </HeaderRight>

      <div className="space-y-4">
        {activeTab === 'person' && (
          <Card>
            <CardContent className={cn('p-4', isMobile && 'p-3')}>
              <PersonStats data={personStats} isLoading={isLoading} />
            </CardContent>
          </Card>
        )}

        {activeTab === 'project' && (
          <Card>
            <CardContent className={cn('p-4', isMobile && 'p-3')}>
              <ProjectStats data={projectStats} isLoading={isLoading} />
            </CardContent>
          </Card>
        )}

        {activeTab === 'completion' && (
          <Card>
            <CardContent className={cn('p-4', isMobile && 'p-3')}>
              <CompletionCheck data={completionCheck} isLoading={isLoading} />
            </CardContent>
          </Card>
        )}
      </div>
    </StandardLayout>
  );
}
