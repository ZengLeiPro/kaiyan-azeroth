import { loadConfig } from './config';
import { runFullSync } from './sync/sync-engine';

/**
 * 本地命令行入口。
 *
 * 用法：
 *   pnpm sync                 # 完整同步（需 AK/SK + DATABASE_URL）
 *   pnpm sync:dry             # dry-run：不写 DB、不强制 AK
 *   pnpm tsx src/index.ts --dry-run
 */
async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');

  console.log('========================================');
  console.log('  cloud-cost-sync - 开始');
  console.log(`  时间: ${new Date().toISOString()}`);
  console.log(`  dryRun: ${dryRun}`);
  console.log('========================================');

  const config = loadConfig({ dryRun });

  if (dryRun && !config.aliyunAccessKeyId) {
    console.log('[main] dry-run 模式且无 AK，仅做 boot 自检后退出。');
    console.log('  - DATABASE_URL 解析:', Boolean(config.databaseUrl));
    console.log('  - BSS endpoint:', config.bssEndpoint);
    console.log('  - CMS endpoint:', config.cmsEndpoint);
    console.log('  - usageLookbackDays:', config.usageLookbackDays);
    process.exit(0);
  }

  const report = await runFullSync(config);

  console.log('\n========================================');
  console.log('  同步结果');
  console.log('========================================');
  console.log(`  快照日期: ${report.snapshot.snapshotDate}`);
  console.log(`  账期: ${report.snapshot.billingCycle}`);
  console.log(`  可用余额: ${report.snapshot.availableBalance ?? 'N/A'}`);
  console.log(`  MTD 扣费: ¥${report.snapshot.mtdAmount.toFixed(2)}`);
  console.log(`  产品账单: ${report.snapshot.productCount} 条`);
  console.log(`  资源包: ${report.snapshot.resourcePackageCount} 条`);
  console.log(`  订阅实例: ${report.snapshot.subscriptionCount} 条`);
  console.log(`  按实例账单: ${report.snapshot.instanceBillCount} 条`);
  console.log(`  用量记录: ${report.usage.count} 条`);
  for (const [k, v] of Object.entries(report.usage.byMetric)) {
    console.log(`    - ${k}: ${v}`);
  }
  console.log(`  预警: 新增 ${report.alerts.created} / 自动恢复 ${report.alerts.resolved}`);
  console.log(`  耗时: ${(report.elapsedMs / 1000).toFixed(1)}s`);

  if (report.errors.length > 0) {
    console.log('\n  错误:');
    for (const e of report.errors) {
      console.log(`    [${e.stage}] ${e.message}`);
    }
    process.exit(1);
  }
}

main().catch((err: unknown) => {
  console.error('cloud-cost-sync 异常退出:', err);
  process.exit(1);
});
