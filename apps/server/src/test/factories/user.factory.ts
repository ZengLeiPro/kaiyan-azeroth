import { hash } from 'bcryptjs';

import type { PrismaService } from '../../common/prisma/prisma.service';

let userSeq = 0;

/**
 * push 6: user 表已删除。该 factory 现在产出 "employee-with-login" 形状的数据，
 * 字段保留 UserData 历史名字（id/username/password/...）以最小化对既有 spec 的改动。
 *
 * createUser 真正落库时写入 prisma.employee（同时 set username/password/canLogin）。
 */
export interface UserData {
  id: string;
  username: string;
  password: string;
  phone: string | null;
  email: string | null;
  avatar: string | null;
  status: string;
  employeeId: string | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
  version: number;
}

const DEFAULT_PASSWORD = 'Test@123456';

export function buildUser(overrides: Partial<UserData> = {}): UserData {
  userSeq++;
  const seq = userSeq.toString().padStart(4, '0');
  const now = new Date();

  return {
    id: `user-test-${seq}`,
    username: `testuser${seq}`,
    password: 'hashed-placeholder',
    phone: null,
    email: null,
    avatar: null,
    status: 'active',
    employeeId: null,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    version: 1,
    ...overrides,
  };
}

/**
 * 在数据库中创建带登录字段的 employee 记录
 * push 6: 实际写入 employee 表
 */
export async function createUser(
  prisma: PrismaService,
  overrides: Partial<UserData & { plainPassword?: string }> = {}
): Promise<UserData & { plainPassword: string }> {
  const plainPassword = overrides.plainPassword ?? DEFAULT_PASSWORD;
  const passwordHash = await hash(plainPassword, 4);

  const data = buildUser({ ...overrides, password: passwordHash });
  const ts = Date.now();

  const created = await prisma.employee.create({
    data: {
      serialNumber: `FAC_USR_${ts}_${userSeq}`,
      name: data.username,
      username: data.username,
      phone: data.phone ?? undefined,
      email: data.email ?? undefined,
      avatar: data.avatar ?? undefined,
      password: passwordHash,
      canLogin: true,
      loginStatus: data.status,
    },
  });

  return {
    ...data,
    id: created.id,
    employeeId: created.id,
    password: passwordHash,
    plainPassword,
    createdAt: created.createdAt,
    updatedAt: created.updatedAt,
  };
}

export function resetUserSeq(): void {
  userSeq = 0;
}
