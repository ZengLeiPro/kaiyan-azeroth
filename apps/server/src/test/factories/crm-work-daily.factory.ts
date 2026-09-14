import { Prisma } from '@prisma/client';

import type { PrismaService } from '../../common/prisma/prisma.service';

let crmWorkDailySeq = 0;

export interface CrmWorkDailyData {
  id: string;
  yccrmId: string | null;
  reportDate: Date | null;
  reportType: string | null;
  submitStatus: string | null;
  senderId: string | null;
  senderName: string | null;
  keyCustomerSummary: string | null;
  tomorrowVisitPlan: string | null;
  otherPlanArrangements: string | null;
  coordinationItems: string | null;
  callsMadeCount: number | null;
  callsConnectedCount: number | null;
  visitCustomerCount: number | null;
  newCustomerCount: number | null;
  newContactMethodCount: number | null;
  attachments: Prisma.JsonValue | null;
  remark: string | null;
  status: string;
  createdAt: Date;
  createdBy: string | null;
  updatedAt: Date;
  updatedBy: string | null;
  deletedAt: Date | null;
  version: number;
}

export function buildCrmWorkDaily(overrides: Partial<CrmWorkDailyData> = {}): CrmWorkDailyData {
  crmWorkDailySeq++;
  const seq = crmWorkDailySeq.toString().padStart(4, '0');
  const now = new Date();

  return {
    id: `crm-work-daily-test-${seq}`,
    yccrmId: null,
    reportDate: now,
    reportType: 'daily',
    submitStatus: 'submitted',
    senderId: null,
    senderName: `测试员工${seq}`,
    keyCustomerSummary: null,
    tomorrowVisitPlan: null,
    otherPlanArrangements: null,
    coordinationItems: null,
    callsMadeCount: 0,
    callsConnectedCount: 0,
    visitCustomerCount: 0,
    newCustomerCount: 0,
    newContactMethodCount: 0,
    attachments: null,
    remark: null,
    status: 'active',
    createdAt: now,
    updatedAt: now,
    createdBy: null,
    updatedBy: null,
    deletedAt: null,
    version: 1,
    ...overrides,
  };
}

export async function createCrmWorkDaily(
  prisma: PrismaService,
  overrides: Partial<CrmWorkDailyData> = {}
): Promise<CrmWorkDailyData> {
  const data = buildCrmWorkDaily(overrides);
  const { id: _id, attachments, ...createData } = data;

  const created = await prisma.crmWorkDaily.create({
    data: {
      ...createData,
      attachments: attachments === null ? Prisma.JsonNull : (attachments as Prisma.InputJsonValue),
    },
  });

  return {
    ...data,
    id: created.id,
    createdAt: created.createdAt,
    updatedAt: created.updatedAt,
  };
}

export function resetCrmWorkDailySeq(): void {
  crmWorkDailySeq = 0;
}
