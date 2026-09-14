import type { PrismaService } from '../../common/prisma/prisma.service';
import { createCustomer, type CustomerData } from './customer.factory';

let opportunitySeq = 0;

export interface OpportunityData {
  id: string;
  serialNumber: string;
  opportunityName: string;
  customerId: string;
  contactId: string | null;
  opportunityStage: string | null;
  opportunityAmount: number | null;
  winRate: number | null;
  expectedDealDate: Date | null;
  realDealDate: Date | null;
  lostDate: Date | null;
  chargerId: string | null;
  chargerName: string | null;
  loseReason: string | null;
  loseReasonDetail: string | null;
  wonSourceType: 'manual' | 'sale_order' | null;
  wonSourceSaleOrderId: string | null;
  wonSourcePreviousStage: string | null;
  wonSourcePreviousDealDate: Date | null;
  wonSourcePreviousWinRate: number | null;
  remark: string | null;
  flowStatus: string | null;
  status: string;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
  createdBy: string | null;
  updatedBy: string | null;
  version: number;
}

export function buildOpportunity(overrides: Partial<OpportunityData> = {}): OpportunityData {
  opportunitySeq++;
  const seq = opportunitySeq.toString().padStart(4, '0');
  const now = new Date();

  return {
    id: `opp-test-${seq}`,
    serialNumber: `SJ${seq}`,
    opportunityName: `测试商机${seq}`,
    customerId: overrides.customerId ?? `cust-placeholder-${seq}`,
    contactId: null,
    opportunityStage: null,
    opportunityAmount: null,
    winRate: null,
    expectedDealDate: null,
    realDealDate: null,
    lostDate: null,
    chargerId: null,
    chargerName: null,
    loseReason: null,
    loseReasonDetail: null,
    wonSourceType: null,
    wonSourceSaleOrderId: null,
    wonSourcePreviousStage: null,
    wonSourcePreviousDealDate: null,
    wonSourcePreviousWinRate: null,
    remark: null,
    flowStatus: null,
    status: 'active',
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    createdBy: null,
    updatedBy: null,
    version: 1,
    ...overrides,
  };
}

/**
 * 在数据库中创建 Opportunity 记录
 * 如果未传 customerId，会自动创建一个 Customer
 */
export async function createOpportunity(
  prisma: PrismaService,
  overrides: Partial<OpportunityData> = {}
): Promise<OpportunityData & { customer?: CustomerData }> {
  let customer: CustomerData | undefined;

  if (!overrides.customerId) {
    customer = await createCustomer(prisma);
    overrides = { ...overrides, customerId: customer.id };
  }

  const data = buildOpportunity(overrides);
  const { id: _id, opportunityAmount, winRate, wonSourcePreviousWinRate, ...createData } = data;

  const created = await prisma.opportunity.create({
    data: {
      ...createData,
      opportunityAmount: opportunityAmount != null ? String(opportunityAmount) : null,
      winRate: winRate != null ? String(winRate) : null,
      wonSourcePreviousWinRate:
        wonSourcePreviousWinRate != null ? String(wonSourcePreviousWinRate) : null,
    },
  });

  return {
    ...data,
    id: created.id,
    createdAt: created.createdAt,
    updatedAt: created.updatedAt,
    customer,
  };
}

export function resetOpportunitySeq(): void {
  opportunitySeq = 0;
}
