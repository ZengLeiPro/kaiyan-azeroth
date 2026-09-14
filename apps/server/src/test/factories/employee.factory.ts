import type { PrismaService } from '../../common/prisma/prisma.service';

let employeeSeq = 0;

export interface EmployeeData {
  id: string;
  serialNumber: string;
  name: string;
  phone: string | null;
  email: string | null;
  gender: string | null;
  position: string | null;
  status: string;
  entryDate: Date | null;
  avatar: string | null;
  jobNumber: string | null;
  workPlace: string | null;
  isAdmin: boolean;
  isBoss: boolean;
  isLeader: boolean;
  dingtalkUserId: string | null;
  dingtalkUnionId: string | null;
  dingtalkActive: boolean;
  tokenInvalidAfter: Date | null;
  lastSyncAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
  createdBy: string | null;
  updatedBy: string | null;
  version: number;
}

export function buildEmployee(overrides: Partial<EmployeeData> = {}): EmployeeData {
  employeeSeq++;
  const seq = employeeSeq.toString().padStart(4, '0');
  const now = new Date();

  return {
    id: `emp-test-${seq}`,
    serialNumber: `YG${seq}`,
    name: `测试员工${seq}`,
    phone: `1380000${seq}`,
    email: null,
    gender: null,
    position: null,
    status: 'active',
    entryDate: null,
    avatar: null,
    jobNumber: null,
    workPlace: null,
    isAdmin: false,
    isBoss: false,
    isLeader: false,
    dingtalkUserId: `dd-${seq}`,
    dingtalkUnionId: `du-${seq}`,
    dingtalkActive: true,
    tokenInvalidAfter: null,
    lastSyncAt: null,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    createdBy: null,
    updatedBy: null,
    version: 1,
    ...overrides,
  };
}

export async function createEmployee(
  prisma: PrismaService,
  overrides: Partial<EmployeeData> = {}
): Promise<EmployeeData> {
  const data = buildEmployee(overrides);
  const { id: _id, ...createData } = data;

  const created = await prisma.employee.create({ data: createData });

  return {
    ...data,
    id: created.id,
    createdAt: created.createdAt,
    updatedAt: created.updatedAt,
  };
}

export function resetEmployeeSeq(): void {
  employeeSeq = 0;
}
