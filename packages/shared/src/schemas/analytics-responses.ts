import { z } from 'zod';

import type { IOrgDepartmentNode } from '../types/analytics';

const rangeMetaSchema = z.object({
  preset: z.string(),
  startDate: z.string(),
  endDate: z.string(),
});

const trendPointSchema = z.object({
  bucket: z.string(),
  value: z.number(),
  count: z.number().optional(),
});

const distributionItemSchema = z.object({
  key: z.string(),
  label: z.string(),
  count: z.number(),
  percentage: z.number(),
  amount: z.number().optional(),
});

const rankingItemSchema = z.object({
  id: z.string(),
  name: z.string(),
  value: z.number(),
  hint: z.string().optional(),
});

export const analyticsOverviewResponseSchema = z.object({
  range: rangeMetaSchema,
  kpis: z.object({
    newCustomersCount: z.number(),
    paymentAmount: z.number(),
    newOrderAmount: z.number(),
    activeProjectCount: z.number(),
    totalEffortHours: z.number(),
    dailyKeepRecordAvg: z.number(),
  }),
  crmFunnelMini: z.array(z.object({ stage: z.string(), count: z.number(), amount: z.number() })),
  projectEffortMini: z.array(
    z.object({ projectId: z.string(), projectName: z.string(), hours: z.number() })
  ),
  dauTrend: z.array(z.object({ bucket: z.string(), value: z.number() })),
  alerts: z.object({
    sleepingSaCount: z.number(),
    overdueProjectCount: z.number(),
    pendingApprovalCount: z.number(),
  }),
});

export const crmKpisResponseSchema = z.object({
  range: rangeMetaSchema,
  customerCount: z.number(),
  opportunityCount: z.number(),
  saleOrderCount: z.number(),
  paymentAmount: z.number(),
  accountsReceivableTotal: z.number(),
  sleepingSaCount: z.number(),
});

export const crmFunnelResponseSchema = z.object({
  range: rangeMetaSchema,
  stages: z.array(z.object({ stage: z.string(), count: z.number(), amount: z.number() })),
});

export const crmTrendResponseSchema = z.object({
  range: rangeMetaSchema,
  metric: z.string(),
  bucket: z.string(),
  points: z.array(trendPointSchema),
});

export const crmDistributionResponseSchema = z.object({
  dimension: z.string(),
  items: z.array(distributionItemSchema),
});

export const crmRankingResponseSchema = z.object({
  range: rangeMetaSchema,
  dimension: z.string(),
  metric: z.string(),
  items: z.array(rankingItemSchema),
});

export const crmAgingResponseSchema = z.object({
  buckets: z.array(z.object({ label: z.string(), customerCount: z.number(), amount: z.number() })),
  total: z.object({ customerCount: z.number(), amount: z.number() }),
});

export const crmSleepingResponseSchema = z.object({
  items: z.array(
    z.object({
      customerId: z.string(),
      customerName: z.string(),
      customerLevel: z.string(),
      chargerId: z.string().nullable(),
      chargerName: z.string().nullable(),
      lastKeepRecordTime: z.string().nullable(),
      daysSinceLastKeep: z.number().nullable(),
    })
  ),
  total: z.number(),
});

export const projectKpisResponseSchema = z.object({
  range: rangeMetaSchema,
  activeProjectCount: z.number(),
  totalProjectCount: z.number(),
  newProjectCountMtd: z.number(),
  overdueProjectCount: z.number(),
  totalEffortHours: z.number(),
  totalLaborCost: z.number(),
  hourlyRateCoverage: z.number(),
});

export const projectDistributionResponseSchema = z.object({
  dimension: z.string(),
  items: z.array(distributionItemSchema),
});

export const projectEffortResponseSchema = z.object({
  range: rangeMetaSchema,
  byProject: z.array(
    z.object({
      projectId: z.string(),
      projectName: z.string(),
      totalHours: z.number(),
      participantCount: z.number(),
    })
  ),
  byPerson: z.array(
    z.object({
      ownerId: z.string(),
      ownerName: z.string(),
      totalHours: z.number(),
      recordCount: z.number(),
      saturation: z.number(),
    })
  ),
  byWorkType: z.array(
    z.object({
      workType: z.string(),
      totalHours: z.number(),
      recordCount: z.number(),
      percentage: z.number(),
    })
  ),
  byCustomer: z.array(
    z.object({
      customerId: z.string(),
      customerName: z.string(),
      totalHours: z.number(),
      totalCost: z.number(),
    })
  ),
});

export const projectTicketsResponseSchema = z.object({
  range: rangeMetaSchema,
  counts: z.object({
    pending: z.number(),
    inProgress: z.number(),
    completed: z.number(),
    closed: z.number(),
    cancelled: z.number(),
    overdue: z.number(),
  }),
  byType: z.array(distributionItemSchema),
  byPriority: z.array(distributionItemSchema),
  slaRate: z.number(),
  avgResolutionHours: z.number(),
  avgClosureHours: z.number(),
});

export const projectOverdueResponseSchema = z.object({
  items: z.array(
    z.object({
      projectId: z.string(),
      projectName: z.string(),
      customerName: z.string().nullable(),
      ownerName: z.string().nullable(),
      status: z.string(),
      endDate: z.string(),
      daysOverdue: z.number(),
    })
  ),
  total: z.number(),
});

export const orgKpisResponseSchema = z.object({
  range: rangeMetaSchema,
  activeHeadcount: z.number(),
  newHiresInPeriod: z.number(),
  leaversInPeriod: z.number(),
  dau30d: z.number(),
  mau: z.number(),
  syncStaleHint: z.object({
    dingtalkLogsUpdatedAt: z.string().nullable(),
    employeeLeavesUpdatedAt: z.string().nullable(),
  }),
});

export const orgCompletionResponseSchema = z.object({
  range: rangeMetaSchema,
  effort: z.object({ expectedSlots: z.number(), filledSlots: z.number(), rate: z.number() }),
  crmDaily: z.object({ expectedSlots: z.number(), filledSlots: z.number(), rate: z.number() }),
  dingtalkDaily: z.object({ expectedSlots: z.number(), filledSlots: z.number(), rate: z.number() }),
});

export const orgSalesActivityResponseSchema = z.object({
  range: rangeMetaSchema,
  keepRecordDensity: z.array(rankingItemSchema),
  visitTrend: z.array(trendPointSchema),
  keepRecordTypeDistribution: z.array(distributionItemSchema),
});

export const orgApprovalSlaResponseSchema = z.object({
  range: rangeMetaSchema,
  endToEndByEventType: z.array(
    z.object({
      eventType: z.string(),
      label: z.string(),
      avgHours: z.number(),
      sampleCount: z.number(),
    })
  ),
  nodeStay: z.array(
    z.object({ nodeName: z.string(), avgHours: z.number(), sampleCount: z.number() })
  ),
  approveRate: z.number(),
  pendingTopApprovers: z.array(rankingItemSchema),
});

export const orgHeadcountTrendResponseSchema = z.object({
  months: z.array(
    z.object({
      month: z.string(),
      activeAtMonthEnd: z.number(),
      newHires: z.number(),
      leavers: z.number(),
    })
  ),
});

const orgDepartmentNodeSchema: z.ZodType<IOrgDepartmentNode> = z.lazy(() =>
  z.object({
    id: z.string(),
    name: z.string(),
    managerId: z.string().nullable(),
    managerName: z.string().nullable(),
    directEmployeeCount: z.number(),
    recursiveEmployeeCount: z.number(),
    children: z.array(orgDepartmentNodeSchema),
  })
);

export const orgDepartmentOverviewResponseSchema = z.object({
  tree: z.array(orgDepartmentNodeSchema),
  missingManagerDepartments: z.array(z.object({ id: z.string(), name: z.string() })),
});
