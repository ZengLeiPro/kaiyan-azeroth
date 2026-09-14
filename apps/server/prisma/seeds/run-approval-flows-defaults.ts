import { PrismaClient } from '@prisma/client';

import { seedApprovalFlowsDefaults } from './09-approval-flows-defaults';

/**
 * 独立入口：仅注入默认审批流程占位（payment_approve），不会跑其它 seed。
 *
 * 用法：
 *   DATABASE_URL='<RDS-URL>' pnpm --filter server seed:approval-flows-defaults
 */
async function main() {
  const prisma = new PrismaClient();
  try {
    console.log('====================================');
    console.log('Seed：默认审批流程占位');
    console.log('====================================');
    await seedApprovalFlowsDefaults(prisma);
    console.log('完成');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error('seed 失败:', err);
  process.exit(1);
});
