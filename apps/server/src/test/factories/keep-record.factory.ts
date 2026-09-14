import { Prisma } from '@prisma/client';

import type { PrismaService } from '../../common/prisma/prisma.service';

let keepRecordSeq = 0;

export interface KeepRecordData {
  id: string;
  yccrmId: string | null;
  customerId: string;
  contactId: string | null;
  keepRecordType: string | null;
  keepRecordTime: Date | null;
  keepRecordContent: string | null;
  keepRecordStatus: string | null;
  signLocation: string | null;
  signAddress: string | null;
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

export function buildKeepRecord(overrides: Partial<KeepRecordData> = {}): KeepRecordData {
  keepRecordSeq++;
  const seq = keepRecordSeq.toString().padStart(4, '0');
  const now = new Date();

  return {
    id: `keep-record-test-${seq}`,
    yccrmId: null,
    customerId: `cust-test-${seq}`,
    contactId: null,
    keepRecordType: 'phone',
    keepRecordTime: now,
    keepRecordContent: `测试跟进记录${seq}`,
    keepRecordStatus: null,
    signLocation: null,
    signAddress: null,
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

export async function createKeepRecord(
  prisma: PrismaService,
  overrides: Partial<KeepRecordData> = {}
): Promise<KeepRecordData> {
  const data = buildKeepRecord(overrides);
  const { id: _id, attachments, ...createData } = data;

  const created = await prisma.keepRecord.create({
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

export function resetKeepRecordSeq(): void {
  keepRecordSeq = 0;
}
