import { Prisma } from '@prisma/client';

import type { PrismaService } from '../../common/prisma/prisma.service';

let visitRecordSeq = 0;

export interface VisitRecordData {
  id: string;
  yccrmId: string | null;
  customerId: string;
  contactId: string | null;
  visitType: string | null;
  content: string | null;
  signInTime: Date | null;
  signOutTime: Date | null;
  signAddress: string | null;
  signLocation: string | null;
  duration: number | null;
  visitStatus: string | null;
  attachments: Prisma.JsonValue | null;
  chargerId: string | null;
  chargerName: string | null;
  createdAt: Date;
  createdBy: string | null;
  updatedAt: Date;
  updatedBy: string | null;
  deletedAt: Date | null;
  version: number;
}

export function buildVisitRecord(overrides: Partial<VisitRecordData> = {}): VisitRecordData {
  visitRecordSeq++;
  const seq = visitRecordSeq.toString().padStart(4, '0');
  const now = new Date();

  return {
    id: `visit-record-test-${seq}`,
    yccrmId: null,
    customerId: `cust-test-${seq}`,
    contactId: null,
    visitType: 'onsite',
    content: `测试拜访记录${seq}`,
    signInTime: now,
    signOutTime: null,
    signAddress: null,
    signLocation: null,
    duration: null,
    visitStatus: null,
    attachments: null,
    chargerId: null,
    chargerName: null,
    createdAt: now,
    updatedAt: now,
    createdBy: null,
    updatedBy: null,
    deletedAt: null,
    version: 1,
    ...overrides,
  };
}

export async function createVisitRecord(
  prisma: PrismaService,
  overrides: Partial<VisitRecordData> = {}
): Promise<VisitRecordData> {
  const data = buildVisitRecord(overrides);
  const { id: _id, attachments, ...createData } = data;

  const created = await prisma.visitRecord.create({
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

export function resetVisitRecordSeq(): void {
  visitRecordSeq = 0;
}
