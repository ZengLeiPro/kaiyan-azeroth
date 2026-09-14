import { PrismaClient } from '@prisma/client';

import {
  seedApprovalFlowsDefaults,
  seedDemoUsers,
  seedEmployeeUsers,
  seedFilterSchemes,
  seedFinanceAccounts,
  seedFinanceSubjects,
  seedRoles,
  seedSystemConfigs,
} from './seeds';
import { assertLocalSeedAllowed } from './seeds/password-file';

const prisma = new PrismaClient();

async function main() {
  assertLocalSeedAllowed(process.env.DATABASE_URL);

  console.log('====================================');
  console.log('开始填充种子数据...');
  console.log('====================================');

  console.log('\n--- Phase 1: 系统基础数据 ---');
  await seedRoles(prisma);
  await seedEmployeeUsers(prisma);
  await seedSystemConfigs(prisma);
  await seedFilterSchemes(prisma);

  console.log('\n--- Phase 2: 审批流程 ---');
  await seedApprovalFlowsDefaults(prisma);

  console.log('\n--- Phase 3: 财务字典 ---');
  await seedFinanceAccounts(prisma);
  await seedFinanceSubjects(prisma);

  console.log('\n--- Phase 4: 可选演示账号 ---');
  await seedDemoUsers(prisma);

  console.log('\n====================================');
  console.log('种子数据填充完成');
  console.log('====================================');
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error('种子数据填充失败:', e);
    await prisma.$disconnect();
    process.exit(1);
  });
