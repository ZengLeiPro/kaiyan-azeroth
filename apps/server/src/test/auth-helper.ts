import { JwtService } from '@nestjs/jwt';
import { hash } from 'bcryptjs';

import { PrismaService } from '../common/prisma/prisma.service';

interface TestUserResult {
  userId: string; // push 6: 等同于 employee.id
  username: string;
  token: string;
}

/**
 * 在测试数据库中创建测试用户并返回 JWT token
 * push 6: 直接在 employee 上设置登录字段（user 表已删）
 */
export async function seedTestUser(
  prisma: PrismaService,
  jwtService: JwtService
): Promise<TestUserResult> {
  const passwordHash = await hash('Test@123456', 4);

  // 创建角色
  const role = await prisma.role.upsert({
    where: { code: 'test-admin' },
    update: {},
    create: {
      code: 'test-admin',
      name: '测试管理员',
      status: 'active',
    },
  });

  const ts = Date.now();
  const username = `testuser_${ts}`;
  const employee = await prisma.employee.create({
    data: {
      serialNumber: `TEST_${ts}`,
      name: `测试_${ts}`,
      username,
      password: passwordHash,
      canLogin: true,
      loginStatus: 'active',
      userRoles: {
        create: { roleId: role.id },
      },
    },
  });

  // 签发 JWT（push 6: sub = employee.id）
  const token = await jwtService.signAsync(
    {
      sub: employee.id,
      eid: employee.id,
      username,
      roles: ['test-admin'],
      tokenType: 'access',
    },
    { secret: process.env.JWT_SECRET || 'test-jwt-secret-key-for-testing-only', expiresIn: '1h' }
  );

  return {
    userId: employee.id,
    username,
    token,
  };
}

/**
 * 直接签发 JWT token（用于不需要真实用户的单元测试场景）
 */
export function createTestJwtToken(
  jwtService: JwtService,
  overrides?: Partial<{
    sub: string;
    username: string;
    roles: string[];
    tokenType: string;
  }>
): Promise<string> {
  return jwtService.signAsync(
    {
      sub: 'test-user-id',
      username: 'testuser',
      roles: ['admin'],
      tokenType: 'access',
      ...overrides,
    },
    { secret: process.env.JWT_SECRET || 'test-jwt-secret-key-for-testing-only', expiresIn: '1h' }
  );
}
