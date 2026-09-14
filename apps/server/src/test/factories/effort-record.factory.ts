import type { PrismaService } from '../../common/prisma/prisma.service';

let effortRecordSeq = 0;

export interface EffortRecordData {
  id: string;
  yunxiaoId: string | null;
  projectId: string;
  actualTime: number;
  description: string | null;
  workType: string | null;
  ownerId: string | null;
  ownerName: string | null;
  startDate: Date | null;
  endDate: Date | null;
  createdAt: Date;
  createdBy: string | null;
  updatedAt: Date;
  updatedBy: string | null;
  deletedAt: Date | null;
  version: number;
}

export function buildEffortRecord(overrides: Partial<EffortRecordData> = {}): EffortRecordData {
  effortRecordSeq++;
  const seq = effortRecordSeq.toString().padStart(4, '0');
  const now = new Date();

  return {
    id: `effort-record-test-${seq}`,
    yunxiaoId: null,
    projectId: `project-test-${seq}`,
    actualTime: 4,
    description: `测试工时记录${seq}`,
    workType: 'development',
    ownerId: null,
    ownerName: `测试员工${seq}`,
    startDate: now,
    endDate: null,
    createdAt: now,
    updatedAt: now,
    createdBy: null,
    updatedBy: null,
    deletedAt: null,
    version: 1,
    ...overrides,
  };
}

export async function createEffortRecord(
  prisma: PrismaService,
  overrides: Partial<EffortRecordData> = {}
): Promise<EffortRecordData> {
  const data = buildEffortRecord(overrides);
  const { id: _id, actualTime, ...createData } = data;

  const created = await prisma.effortRecord.create({
    data: {
      ...createData,
      actualTime: String(actualTime),
    },
  });

  return {
    ...data,
    id: created.id,
    createdAt: created.createdAt,
    updatedAt: created.updatedAt,
  };
}

export function resetEffortRecordSeq(): void {
  effortRecordSeq = 0;
}
