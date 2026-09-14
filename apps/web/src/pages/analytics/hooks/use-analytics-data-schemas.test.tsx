import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useAnalyticsOverview } from './use-analytics-overview-data';
import {
  useCrmAging,
  useCrmDistribution,
  useCrmFunnel,
  useCrmKpis,
  useCrmRanking,
  useCrmSleeping,
  useCrmTrend,
} from './use-crm-analytics-data';
import {
  useOrgApprovalSla,
  useOrgCompletion,
  useOrgDepartmentOverview,
  useOrgHeadcountTrend,
  useOrgKpis,
  useOrgSalesActivity,
} from './use-org-analytics-data';
import {
  useProjectDistribution,
  useProjectEffort,
  useProjectKpis,
  useProjectOverdue,
  useProjectTickets,
} from './use-project-analytics-data';

const mocks = vi.hoisted(() => ({ apiGet: vi.fn() }));

vi.mock('@/lib/api', () => ({ api: { get: mocks.apiGet } }));

const range = { preset: 'mtd' } as const;
const rangeMeta = { preset: 'mtd', startDate: '2026-09-01', endDate: '2026-09-05' };
const slot = { expectedSlots: 10, filledSlots: 8, rate: 0.8 };

/** 每个端点一份满足 shared Zod schema 的最小合法响应。 */
const RESPONSES: Record<string, unknown> = {
  '/analytics/overview': {
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
  },
  '/analytics/crm/kpis': {
    range: rangeMeta,
    customerCount: 1,
    opportunityCount: 2,
    saleOrderCount: 3,
    paymentAmount: 4,
    accountsReceivableTotal: 5,
    sleepingSaCount: 6,
  },
  '/analytics/crm/funnel': { range: rangeMeta, stages: [] },
  '/analytics/crm/trend': { range: rangeMeta, metric: 'payment_amount', bucket: 'day', points: [] },
  '/analytics/crm/distribution': { dimension: 'level', items: [] },
  '/analytics/crm/ranking': {
    range: rangeMeta,
    dimension: 'salesperson',
    metric: 'paid_amount',
    items: [],
  },
  '/analytics/crm/aging': { buckets: [], total: { customerCount: 0, amount: 0 } },
  '/analytics/crm/sleeping': { items: [], total: 0 },
  '/analytics/projects/kpis': {
    range: rangeMeta,
    activeProjectCount: 1,
    totalProjectCount: 2,
    newProjectCountMtd: 3,
    overdueProjectCount: 4,
    totalEffortHours: 5,
    totalLaborCost: 6,
    hourlyRateCoverage: 7,
  },
  '/analytics/projects/distribution': { dimension: 'status', items: [] },
  '/analytics/projects/effort': {
    range: rangeMeta,
    byProject: [],
    byPerson: [],
    byWorkType: [],
    byCustomer: [],
  },
  '/analytics/projects/tickets': {
    range: rangeMeta,
    counts: { pending: 0, inProgress: 0, completed: 0, closed: 0, cancelled: 0, overdue: 0 },
    byType: [],
    byPriority: [],
    slaRate: 1,
    avgResolutionHours: 2,
    avgClosureHours: 3,
  },
  '/analytics/projects/overdue': { items: [], total: 0 },
  '/analytics/organization/kpis': {
    range: rangeMeta,
    activeHeadcount: 1,
    newHiresInPeriod: 2,
    leaversInPeriod: 3,
    dau30d: 4,
    mau: 5,
    syncStaleHint: { dingtalkLogsUpdatedAt: null, employeeLeavesUpdatedAt: null },
  },
  '/analytics/organization/completion': {
    range: rangeMeta,
    effort: slot,
    crmDaily: slot,
    dingtalkDaily: slot,
  },
  '/analytics/organization/sales-activity': {
    range: rangeMeta,
    keepRecordDensity: [],
    visitTrend: [],
    keepRecordTypeDistribution: [],
  },
  '/analytics/organization/approval-sla': {
    range: rangeMeta,
    endToEndByEventType: [],
    nodeStay: [],
    approveRate: 0.9,
    pendingTopApprovers: [],
  },
  '/analytics/organization/headcount-trend': { months: [] },
  '/analytics/organization/department-overview': { tree: [], missingManagerDepartments: [] },
};

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  mocks.apiGet.mockReset();
  mocks.apiGet.mockImplementation(async (url: string) => {
    if (!(url in RESPONSES)) throw new Error(`未预期的分析端点 ${url}`);
    return { data: RESPONSES[url] };
  });
});

const CASES: Array<[string, () => unknown, string]> = [
  ['经营总览', () => useAnalyticsOverview(range), '/analytics/overview'],
  ['CRM KPI', () => useCrmKpis(range), '/analytics/crm/kpis'],
  ['CRM 漏斗', () => useCrmFunnel(range), '/analytics/crm/funnel'],
  ['CRM 趋势', () => useCrmTrend(range, 'payment_amount', 'day'), '/analytics/crm/trend'],
  ['CRM 分布', () => useCrmDistribution('level'), '/analytics/crm/distribution'],
  [
    'CRM 排行',
    () => useCrmRanking(range, 'salesperson', 'paid_amount', 10),
    '/analytics/crm/ranking',
  ],
  ['CRM 账龄', () => useCrmAging(), '/analytics/crm/aging'],
  ['CRM 沉睡客户', () => useCrmSleeping(), '/analytics/crm/sleeping'],
  ['项目 KPI', () => useProjectKpis(range), '/analytics/projects/kpis'],
  ['项目分布', () => useProjectDistribution('status'), '/analytics/projects/distribution'],
  ['项目工时', () => useProjectEffort(range), '/analytics/projects/effort'],
  ['项目工单', () => useProjectTickets(range), '/analytics/projects/tickets'],
  ['延期项目', () => useProjectOverdue(), '/analytics/projects/overdue'],
  ['组织 KPI', () => useOrgKpis(range), '/analytics/organization/kpis'],
  ['填报完成率', () => useOrgCompletion(range), '/analytics/organization/completion'],
  ['销售活动', () => useOrgSalesActivity(range), '/analytics/organization/sales-activity'],
  ['审批时效', () => useOrgApprovalSla(range), '/analytics/organization/approval-sla'],
  ['人员趋势', () => useOrgHeadcountTrend(12), '/analytics/organization/headcount-trend'],
  ['部门概览', () => useOrgDepartmentOverview(), '/analytics/organization/department-overview'],
];

describe('analytics data hooks 运行时 schema', () => {
  it.each(CASES)('%s 按 shared schema 解析合法响应', async (_label, useHook, endpoint) => {
    const { result } = renderHook(() => useHook() as { isSuccess: boolean; data: unknown }, {
      wrapper,
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(RESPONSES[endpoint]);
    expect(mocks.apiGet.mock.calls.map((call) => call[0])).toContain(endpoint);
  });

  it('字段漂移时进入 isError 而不是把脏数据交给页面', async () => {
    mocks.apiGet.mockResolvedValueOnce({ data: { range: rangeMeta, kpis: {} } });
    const { result } = renderHook(() => useAnalyticsOverview(range), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.data).toBeUndefined();
  });
});
