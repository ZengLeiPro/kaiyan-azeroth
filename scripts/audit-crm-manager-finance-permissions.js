#!/usr/bin/env node

function evaluateSnapshot(role) {
  if (!role) return { status: 'role-missing', financePermissions: [], members: [] };
  const financePermissions = role.permissions.filter(
    (permission) =>
      permission.module === 'finance' &&
      [
        permission.view,
        permission.create,
        permission.edit,
        permission.delete,
        permission.export,
        permission.approve,
      ].some(Boolean)
  );
  return {
    status: financePermissions.length === 0 ? 'clean' : 'unexpected-finance-permissions',
    financePermissions,
    members: role.users.map(({ employee }) => ({ id: employee.id, name: employee.name })),
  };
}

async function main() {
  if (!process.argv.includes('--confirm-read-only-role')) {
    throw new Error('必须使用仅有 SELECT 权限的数据库账号，并显式传 --confirm-read-only-role');
  }
  const databaseUrl = process.env.READ_ONLY_DATABASE_URL;
  if (!databaseUrl) throw new Error('缺少 READ_ONLY_DATABASE_URL；禁止复用应用写账号');
  const parsed = new URL(databaseUrl);
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) {
    throw new Error('READ_ONLY_DATABASE_URL 必须是 PostgreSQL URL');
  }

  process.env.DATABASE_URL = databaseUrl;
  const { PrismaClient } = require('@prisma/client');
  const prisma = new PrismaClient();
  try {
    const role = await prisma.role.findUnique({
      where: { code: 'CRM_MANAGER' },
      select: {
        code: true,
        name: true,
        permissions: {
          select: {
            module: true,
            menu: true,
            view: true,
            create: true,
            edit: true,
            delete: true,
            export: true,
            approve: true,
            viewScope: true,
          },
          orderBy: [{ module: 'asc' }, { menu: 'asc' }],
        },
        users: {
          select: { employee: { select: { id: true, name: true } } },
          orderBy: { employeeId: 'asc' },
        },
      },
    });
    const result = evaluateSnapshot(role);
    console.log(
      JSON.stringify(
        { databaseHost: parsed.hostname, role: role?.code ?? null, ...result },
        null,
        2
      )
    );
    if (result.status === 'unexpected-finance-permissions') process.exitCode = 2;
  } finally {
    await prisma.$disconnect();
  }
}

module.exports = { evaluateSnapshot };

if (require.main === module) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
