import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { randomUUID } from 'node:crypto';

import { assertLocalSeedAllowed, readPasswordFile } from './password-file';

/**
 * 空库一次性 bootstrap：
 * - 创建 admin，绑定 ADMIN 角色矩阵（权限只来自角色，不来自 env）
 * - 创建 approver，绑定 CRM_MANAGER，供默认审批流使用
 * - 已存在的账号不改密、不改 UUID、不改角色
 * - 不按手机号找人，不批量启用外部通讯录员工
 */
export async function seedEmployeeUsers(prisma: PrismaClient) {
  assertLocalSeedAllowed(process.env.DATABASE_URL);
  console.log('[Bootstrap] 初始化管理员与审批员...');

  const adminRole = await prisma.role.findFirst({ where: { code: 'ADMIN' } });
  const approverRole = await prisma.role.findFirst({ where: { code: 'CRM_MANAGER' } });
  if (!adminRole || !approverRole) {
    throw new Error('角色矩阵未就绪，无法 bootstrap');
  }

  const admin = await ensureEmployee({
    prisma,
    username: 'admin',
    name: 'Administrator',
    serialPrefix: 'ADMIN',
    roleId: adminRole.id,
    passwordEnv: 'AZEROTH_BOOTSTRAP_PASSWORD_FILE',
  });

  const approver = await ensureEmployee({
    prisma,
    username: 'approver',
    name: 'Approver',
    serialPrefix: 'APPR',
    roleId: approverRole.id,
    passwordEnv: 'AZEROTH_APPROVER_PASSWORD_FILE',
  });

  if (admin.id === approver.id) {
    throw new Error('管理员与审批员不能是同一人');
  }

  console.log(`[Bootstrap] admin employeeId=${admin.id}`);
  console.log(`[Bootstrap] approver employeeId=${approver.id}`);
  console.log('[Bootstrap] 将 admin UUID 写入 SUPER_ADMIN_EMPLOYEE_ID（保护锁，不授予额外权限）');
}

async function ensureEmployee(params: {
  prisma: PrismaClient;
  username: string;
  name: string;
  serialPrefix: string;
  roleId: string;
  passwordEnv: string;
}) {
  return params.prisma.$transaction(async (tx) => {
    const existing = await tx.employee.findFirst({
      where: { username: params.username, deletedAt: null },
    });
    if (existing) {
      const hasRole = await tx.userRole.findFirst({
        where: { employeeId: existing.id, roleId: params.roleId },
      });
      if (!hasRole) {
        await tx.userRole.create({
          data: { employeeId: existing.id, roleId: params.roleId },
        });
        console.log(`  - ${params.username} 已存在但缺角色，已补绑定 → ${existing.id}`);
      } else {
        console.log(`  - ${params.username} 已存在，跳过改密与改角色 → ${existing.id}`);
      }
      return existing;
    }

    const password = await bcrypt.hash(readPasswordFile(params.passwordEnv), 12);
    const created = await tx.employee.create({
      data: {
        id: randomUUID(),
        serialNumber: `${params.serialPrefix}_${Date.now()}`,
        name: params.name,
        username: params.username,
        password,
        canLogin: true,
        loginStatus: 'active',
      },
    });
    await tx.userRole.create({
      data: { employeeId: created.id, roleId: params.roleId },
    });
    console.log(`  - 创建 ${params.username} → ${created.id}`);
    return created;
  });
}
