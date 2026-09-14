import { PrismaClient } from '@prisma/client';

import { BssClientWrapper } from '../aliyun/bss-client';
import { CmsClientWrapper } from '../aliyun/cms-client';
import type { CloudCostSyncConfig } from '../config';
import { type AlertEngineResult, runAlertEngine } from './alert-engine';
import { type SnapshotResult, syncSnapshot } from './sync-snapshot';
import { syncUsage, type UsageResult } from './sync-usage';

export interface FullSyncReport {
  snapshot: {
    snapshotDate: string;
    billingCycle: string;
    productCount: number;
    resourcePackageCount: number;
    subscriptionCount: number;
    instanceBillCount: number;
    availableBalance: number | null;
    mtdAmount: number;
  };
  usage: { count: number; byMetric: Record<string, number> };
  alerts: AlertEngineResult;
  errors: Array<{ stage: string; message: string }>;
  elapsedMs: number;
}

/**
 * 主编排：抓快照 → 抓用量 → 跑预警引擎。
 *
 * 每一步都包了 try/catch；快照失败时后续步骤仍尝试运行（预警可能因缺数据而少触发，但不应整体崩）。
 */
export async function runFullSync(config: CloudCostSyncConfig): Promise<FullSyncReport> {
  const startTs = Date.now();
  const errors: FullSyncReport['errors'] = [];

  const bss = new BssClientWrapper({
    accessKeyId: config.aliyunAccessKeyId,
    accessKeySecret: config.aliyunAccessKeySecret,
    endpoint: config.bssEndpoint,
    throttleMs: config.bssThrottleMs,
  });

  const cms = new CmsClientWrapper({
    accessKeyId: config.aliyunAccessKeyId,
    accessKeySecret: config.aliyunAccessKeySecret,
    endpoint: config.cmsEndpoint,
    throttleMs: config.bssThrottleMs,
  });

  const prisma = new PrismaClient({ datasourceUrl: config.databaseUrl });

  let snapshot: SnapshotResult | null = null;
  let usage: UsageResult = { count: 0, byMetric: {} };
  let alerts: AlertEngineResult = { created: 0, resolved: 0, totalActive: 0 };

  try {
    // 1) 快照
    try {
      snapshot = await syncSnapshot({
        bss,
        prisma,
        accountId: config.aliyunAccountUid,
        dryRun: config.dryRun,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[engine] snapshot 阶段异常: ${msg}`);
      errors.push({ stage: 'snapshot', message: msg });
    }

    // 2) 用量
    try {
      usage = await syncUsage({
        bss,
        cms,
        prisma,
        lookbackDays: config.usageLookbackDays,
        dryRun: config.dryRun,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[engine] usage 阶段异常: ${msg}`);
      errors.push({ stage: 'usage', message: msg });
    }

    // 3) 预警（依赖 snapshot；缺则跳过）
    if (snapshot) {
      try {
        alerts = await runAlertEngine({ prisma, bss, snapshot, dryRun: config.dryRun });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[engine] alert 阶段异常: ${msg}`);
        errors.push({ stage: 'alert', message: msg });
      }
    } else {
      errors.push({ stage: 'alert', message: 'snapshot 缺失，跳过预警' });
    }
  } finally {
    await prisma.$disconnect();
  }

  const elapsedMs = Date.now() - startTs;

  const report: FullSyncReport = {
    snapshot: {
      snapshotDate: snapshot?.snapshotDate ?? '',
      billingCycle: snapshot?.billingCycle ?? '',
      productCount: snapshot?.productBills.length ?? 0,
      resourcePackageCount: snapshot?.resourcePackages.length ?? 0,
      subscriptionCount: snapshot?.subscriptions.length ?? 0,
      instanceBillCount: snapshot?.instanceBills.length ?? 0,
      availableBalance: snapshot?.balance?.availableAmount ?? null,
      mtdAmount: snapshot?.productBills.reduce((s, p) => s + p.pretaxAmount, 0) ?? 0,
    },
    usage,
    alerts,
    errors,
    elapsedMs,
  };

  return report;
}
