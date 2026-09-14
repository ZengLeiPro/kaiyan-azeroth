import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import AnalyticsOverviewPage from '../AnalyticsOverviewPage';
import CrmAnalyticsPage from '../CrmAnalyticsPage';
import OrgAnalyticsPage from '../OrgAnalyticsPage';
import ProjectAnalyticsPage from '../ProjectAnalyticsPage';

const { state, rangeMeta, query, failed } = vi.hoisted(() => {
  const hoistedState = { withKpis: false as boolean };
  const meta = { preset: 'mtd', startDate: '2026-09-01', endDate: '2026-09-05' };
  const makeQuery = (data?: unknown) => ({
    data,
    isLoading: false,
    isError: data === undefined,
    isFetching: false,
    refetch: async () => undefined,
  });
  return {
    state: hoistedState,
    rangeMeta: meta,
    query: makeQuery,
    failed: () => makeQuery(undefined),
  };
});

vi.mock('@/pages/analytics/hooks/use-analytics-overview-data', () => ({
  useAnalyticsOverview: () =>
    state.withKpis
      ? query({
          range: rangeMeta,
          kpis: {
            newCustomersCount: 1,
            paymentAmount: 2,
            newOrderAmount: 3,
            activeProjectCount: 4,
            totalEffortHours: 5,
            dailyKeepRecordAvg: 6,
          },
          crmFunnelMini: [],
          projectEffortMini: [],
          dauTrend: [],
          alerts: { sleepingSaCount: 0, overdueProjectCount: 0, pendingApprovalCount: 0 },
        })
      : failed(),
}));

vi.mock('@/pages/analytics/hooks/use-crm-analytics-data', () => ({
  useCrmKpis: () =>
    state.withKpis
      ? query({
          range: rangeMeta,
          customerCount: 1,
          opportunityCount: 2,
          saleOrderCount: 3,
          paymentAmount: 4,
          accountsReceivableTotal: 5,
          sleepingSaCount: 6,
        })
      : failed(),
  useCrmFunnel: failed,
  useCrmTrend: failed,
  useCrmDistribution: failed,
  useCrmRanking: failed,
  useCrmAging: failed,
  useCrmSleeping: failed,
}));

vi.mock('@/pages/analytics/hooks/use-org-analytics-data', () => ({
  useOrgKpis: () =>
    state.withKpis
      ? query({
          range: rangeMeta,
          activeHeadcount: 1,
          newHiresInPeriod: 2,
          leaversInPeriod: 3,
          dau30d: 4,
          mau: 5,
          syncStaleHint: { dingtalkLogsUpdatedAt: null, employeeLeavesUpdatedAt: null },
        })
      : failed(),
  useOrgCompletion: failed,
  useOrgSalesActivity: failed,
  useOrgApprovalSla: failed,
  useOrgHeadcountTrend: failed,
  useOrgDepartmentOverview: failed,
}));

vi.mock('@/pages/analytics/hooks/use-project-analytics-data', () => ({
  useProjectKpis: () =>
    state.withKpis
      ? query({
          range: rangeMeta,
          activeProjectCount: 1,
          totalProjectCount: 2,
          newProjectCountMtd: 3,
          overdueProjectCount: 4,
          totalEffortHours: 5,
          totalLaborCost: 6,
          hourlyRateCoverage: 7,
        })
      : failed(),
  useProjectDistribution: failed,
  useProjectEffort: failed,
  useProjectTickets: failed,
  useProjectOverdue: failed,
}));

function renderPage(page: React.ReactElement) {
  return render(<MemoryRouter>{page}</MemoryRouter>);
}

const PAGES: Array<[string, () => React.ReactElement, boolean]> = [
  ['经营总览', () => <AnalyticsOverviewPage />, false],
  ['CRM 经营盘', () => <CrmAnalyticsPage />, true],
  ['项目交付盘', () => <ProjectAnalyticsPage />, true],
  ['组织效率盘', () => <OrgAnalyticsPage />, true],
];

beforeEach(() => {
  state.withKpis = false;
  vi.stubGlobal(
    'ResizeObserver',
    class ResizeObserver {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    }
  );
});

describe('经营分析页错误态', () => {
  it.each(PAGES)('%s 全部查询失败时明确显示失败而非空数据', (_label, page) => {
    renderPage(page());
    expect(screen.getByText('数据范围加载失败')).not.toBeNull();
    expect(screen.getByText('数据加载失败')).not.toBeNull();
    expect(screen.getAllByText('加载失败').length).toBeGreaterThan(0);
    expect(screen.queryByText('加载中...')).toBeNull();
  });

  it.each(PAGES)('%s 核心指标成功、其余失败时只标记失败区域', (_label, page, multiQuery) => {
    state.withKpis = true;
    renderPage(page());
    expect(screen.getByText(/数据范围：2026-09-01 ~ 2026-09-05/)).not.toBeNull();
    if (multiQuery) {
      expect(screen.getByText('部分数据加载失败')).not.toBeNull();
    } else {
      expect(screen.queryByText('数据加载失败')).toBeNull();
    }
  });
});
