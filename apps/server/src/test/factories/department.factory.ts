import type { PrismaService } from '../../common/prisma/prisma.service';

let departmentSeq = 0;

export interface DepartmentData {
  id: string;
  name: string;
  parentId: string | null;
  managerId: string | null;
  status: string;
  sortOrder: number;
  dingtalkDeptId: number | null;
  dingtalkParentId: number | null;
  createDeptGroup: boolean;
  autoAddUser: boolean;
  lastSyncAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
  createdBy: string | null;
  updatedBy: string | null;
  version: number;
}

export function buildDepartment(overrides: Partial<DepartmentData> = {}): DepartmentData {
  departmentSeq++;
  const seq = departmentSeq.toString().padStart(4, '0');
  const now = new Date();

  return {
    id: `dept-test-${seq}`,
    name: `测试部门${seq}`,
    parentId: null,
    managerId: null,
    status: 'active',
    sortOrder: departmentSeq,
    dingtalkDeptId: null,
    dingtalkParentId: null,
    createDeptGroup: false,
    autoAddUser: false,
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

export async function createDepartment(
  prisma: PrismaService,
  overrides: Partial<DepartmentData> = {}
): Promise<DepartmentData> {
  const data = buildDepartment(overrides);
  const { id: _id, ...createData } = data;

  const created = await prisma.department.create({ data: createData });

  return {
    ...data,
    id: created.id,
    createdAt: created.createdAt,
    updatedAt: created.updatedAt,
  };
}

export function resetDepartmentSeq(): void {
  departmentSeq = 0;
}
