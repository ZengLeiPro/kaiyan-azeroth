import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { randomUUID } from 'node:crypto';

import { readPasswordFile } from './password-file';

/**
 * 可选演示账号。设置 AZEROTH_SEED_DEMO=1 后才会运行。
 * 销售 A / 销售 B 使用 SALES 角色，密码互不相同，且不得与 admin/approver 相同。
 */
export async function seedDemoUsers(prisma: PrismaClient) {
  if (process.env.AZEROTH_SEED_DEMO !== '1') {
    console.log('[DemoUsers] 未设置 AZEROTH_SEED_DEMO=1，跳过');
    return;
  }

  const salesRole = await prisma.role.findFirst({ where: { code: 'SALES' } });
  if (!salesRole) {
    throw new Error('SALES 角色不存在，无法创建演示销售');
  }

  const passwordA = readPasswordFile('AZEROTH_DEMO_SALES_A_PASSWORD_FILE');
  const passwordB = readPasswordFile('AZEROTH_DEMO_SALES_B_PASSWORD_FILE');
  if (passwordA === passwordB) {
    throw new Error('销售 A/B 密码必须不同');
  }

  await ensureSales(prisma, salesRole.id, 'sales_a', 'Sales A', passwordA);
  await ensureSales(prisma, salesRole.id, 'sales_b', 'Sales B', passwordB);
}

async function ensureSales(
  prisma: PrismaClient,
  roleId: string,
  username: string,
  name: string,
  password: string
) {
  const existing = await prisma.employee.findFirst({
    where: { username, deletedAt: null },
  });
  if (existing) {
    console.log(`  - 演示账号 ${username} 已存在，跳过改密 → ${existing.id}`);
    return;
  }
  const created = await prisma.employee.create({
    data: {
      id: randomUUID(),
      serialNumber: `${username.toUpperCase()}_${Date.now()}`,
      name,
      username,
      password: await bcrypt.hash(password, 12),
      canLogin: true,
      loginStatus: 'active',
    },
  });
  await prisma.userRole.create({
    data: { employeeId: created.id, roleId },
  });
  console.log(`  - 创建演示账号 ${username} → ${created.id}`);
}
