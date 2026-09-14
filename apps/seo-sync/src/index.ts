import { loadConfig } from './config';
import { runFullSync } from './sync/sync-engine';

/**
 * 本地命令行入口。
 *
 * 用法：
 *   pnpm sync                 # 完整同步（需 SEO_BING_API_KEY + SEO_CLARITY_API_TOKEN + DATABASE_URL）
 *   pnpm sync:dry             # dry-run：不写 DB、不强制 API key
 *   pnpm tsx src/index.ts --dry-run
 */
async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');

  console.log('========================================');
  console.log('  seo-sync - 开始');
  console.log(`  时间: ${new Date().toISOString()}`);
  console.log(`  dryRun: ${dryRun}`);
  console.log('========================================');

  const config = loadConfig({ dryRun });

  if (dryRun && !config.bingApiKey && !config.clarityApiToken) {
    console.log('[main] dry-run 模式且无任何 API key，仅做 boot 自检后退出。');
    console.log('  - DATABASE_URL 解析:', Boolean(config.databaseUrl));
    console.log('  - bingSiteUrl:', config.bingSiteUrl);
    console.log('  - clarityProjectId:', config.clarityProjectId);
    console.log('  - claritySiteUrl:', config.claritySiteUrl);
    console.log('  - clarityNumOfDays:', config.clarityNumOfDays);
    console.log('  - throttleMs:', config.throttleMs);
    process.exit(0);
  }

  const report = await runFullSync(config, 'manual');

  console.log('\n========================================');
  console.log('  同步结果');
  console.log('========================================');
  if (report.bing) {
    console.log(`  Bing: 抓取 ${report.bing.fetched} 条 / 写入 ${report.bing.written} 条`);
    console.log(`        时间窗 ${report.bing.fromDate} ~ ${report.bing.toDate}`);
  } else {
    console.log('  Bing: 未运行或失败');
  }
  if (report.clarity) {
    console.log(
      `  Clarity: 指标 ${report.clarity.metricCount} 个 / 写入 ${report.clarity.written} 条`
    );
    console.log(`           归属日期 ${report.clarity.statDate}`);
  } else {
    console.log('  Clarity: 未运行或失败');
  }
  console.log(`  耗时: ${(report.elapsedMs / 1000).toFixed(1)}s`);
  if (report.runId) {
    console.log(`  SyncRun ID: ${report.runId}`);
  }

  if (report.errors.length > 0) {
    console.log('\n  错误:');
    for (const e of report.errors) {
      console.log(`    [${e.source}/${e.stage}] ${e.message}`);
    }
    process.exit(1);
  }
}

main().catch((err: unknown) => {
  console.error('seo-sync 异常退出:', err);
  process.exit(1);
});
