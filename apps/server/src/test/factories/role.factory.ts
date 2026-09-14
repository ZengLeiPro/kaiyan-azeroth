import type { PrismaService } from '../../common/prisma/prisma.service';

let roleSeq = 0;

export interface RoleData {
  id: string;
  name: string;
  code: string;
  description: string | null;
  status: string;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
  createdBy: string | null;
  updatedBy: string | null;
  version: number;
}

export function buildRole(overrides: Partial<RoleData> = {}): RoleData {
  roleSeq++;
  const seq = roleSeq.toString().padStart(4, '0');
  const now = new Date();

  return {
    id: `role-test-${seq}`,
    name: `测试角色${seq}`,
    code: `ROLE_${seq}`,
    description: null,
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

export async function createRole(
  prisma: PrismaService,
  overrides: Partial<RoleData> = {}
): Promise<RoleData> {
  const data = buildRole(overrides);
  const { id: _id, ...createData } = data;

  const created = await prisma.role.create({ data: createData });

  return {
    ...data,
    id: created.id,
    createdAt: created.createdAt,
    updatedAt: created.updatedAt,
  };
}

export function resetRoleSeq(): void {
  roleSeq = 0;
}
