import { CLOUD_PRODUCT_CODE_VALUES, CLOUD_VENDOR } from '@ky-azeroth/shared';
import { Prisma, PrismaClient } from '@prisma/client';

import type { BssClientWrapper } from '../aliyun/bss-client';
import type {
  AccountBalanceInfo,
  InstanceBillRow,
  ProductBillRow,
  ResourcePackageRow,
} from '../aliyun/types';
import { currentCycleBeijing, parseDateOnly, todayBeijing } from '../utils/date';

/** 已知有资源包/相关产品的代码集合（来自 4-08 调研） */
const PACKAGE_PRODUCT_CANDIDATES = [
  'fc',
  'oss',
  'cdt',
  'rds',
  'kvstore',
  'ecs',
  'vpc',
  'cdn',
  'dcdn',
  'vod',
  'live',
  'sls',
  'bailian',
] as const;

/** 业务 productCode 列表（仅用于校验子集，避免 lint 警告未使用导入） */
const KNOWN_PRODUCT_CODES = new Set<string>(CLOUD_PRODUCT_CODE_VALUES);

export interface SnapshotResult {
  snapshotDate: string;
  billingCycle: string;
  balance: AccountBalanceInfo | null;
  productBills: ProductBillRow[];
  resourcePackages: ResourcePackageRow[];
  subscriptions: InstanceBillRow[];
  instanceBills: InstanceBillRow[];
  /** 已知 productCode 但本次拉取没数据的列表，仅用于诊断 */
  unseenProductCodes: string[];
}

export interface SyncSnapshotOptions {
  bss: BssClientWrapper;
  prisma: PrismaClient;
  accountId: string | null;
  dryRun: boolean;
}

/**
 * 抓取并写入 CloudBillSnapshot。
 *
 * 数据流：
 *   - 余额（QueryAccountBalance）
 *   - 当月按产品账单（QueryAccountBill, granularity=MONTHLY, group_by_product=true）
 *   - 当月按实例账单（DescribeInstanceBill, granularity=MONTHLY）
 *   - 所有候选产品的资源包（QueryResourcePackageInstances）
 *   - 包年包月类实例：从实例账单里 filter subscription_type === 'Subscription'
 *
 * 写入：按 (vendor, snapshotDate) upsert 一行。
 */
export async function syncSnapshot(options: SyncSnapshotOptions): Promise<SnapshotResult> {
  const { bss, prisma, accountId, dryRun } = options;
  const snapshotDate = todayBeijing();
  const billingCycle = currentCycleBeijing();

  console.log(
    `[snapshot] 抓取 vendor=${CLOUD_VENDOR.ALIYUN} cycle=${billingCycle} date=${snapshotDate}`
  );

  const requiredSourceErrors: string[] = [];

  // 1) 余额
  let balance: AccountBalanceInfo | null = null;
  try {
    balance = await bss.queryAccountBalance();
    console.log(
      `[snapshot] 余额: available=¥${balance.availableAmount.toFixed(2)} cash=¥${balance.availableCashAmount.toFixed(2)}`
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[snapshot] 余额拉取失败: ${msg}`);
    requiredSourceErrors.push(`余额: ${msg}`);
  }

  // 2) 按产品账单
  let productBills: ProductBillRow[] = [];
  try {
    productBills = await bss.queryAccountBill(billingCycle, { groupByProduct: true });
    console.log(`[snapshot] 按产品账单: ${productBills.length} 条`);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[snapshot] 按产品账单拉取失败: ${msg}`);
    requiredSourceErrors.push(`按产品账单: ${msg}`);
  }

  // 3) 按实例账单（含订阅/按量混合）
  let instanceBills: InstanceBillRow[] = [];
  try {
    instanceBills = await bss.describeInstanceBill(billingCycle);
    console.log(`[snapshot] 按实例账单: ${instanceBills.length} 条`);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[snapshot] 按实例账单拉取失败: ${msg}`);
    requiredSourceErrors.push(`按实例账单: ${msg}`);
  }

  // 4) 资源包：扫所有候选产品
  const resourcePackages: ResourcePackageRow[] = [];
  for (const prod of PACKAGE_PRODUCT_CANDIDATES) {
    try {
      const pkgs = await bss.queryResourcePackageInstances(prod);
      if (pkgs.length > 0) {
        console.log(`[snapshot]   资源包 ${prod}: ${pkgs.length} 条`);
        resourcePackages.push(...pkgs);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[snapshot]   资源包 ${prod} 拉取失败: ${msg}`);
      requiredSourceErrors.push(`资源包 ${prod}: ${msg}`);
    }
  }
  console.log(`[snapshot] 资源包合计: ${resourcePackages.length} 条`);

  if (requiredSourceErrors.length > 0) {
    throw new Error(`快照关键数据源拉取失败，已跳过快照写入: ${requiredSourceErrors.join('；')}`);
  }

  // 5) 订阅类实例
  const subscriptions = instanceBills.filter((b) => b.subscriptionType === 'Subscription');
  console.log(`[snapshot] 订阅实例: ${subscriptions.length} 条`);

  // 6) 计算未覆盖产品（仅诊断用）
  const seen = new Set(productBills.map((p) => p.productCode));
  const unseen = [...KNOWN_PRODUCT_CODES].filter((c) => !seen.has(c));

  // 7) 累计 MTD
  const mtdAmount = productBills.reduce((s, p) => s + p.pretaxAmount, 0);
  const mtdGross = productBills.reduce((s, p) => s + p.pretaxGrossAmount, 0);

  // 8) 写入数据库
  if (!dryRun) {
    const snapshotDateObj = parseDateOnly(snapshotDate);

    const productBillsJson = productBills.map((p) => ({
      productCode: p.productCode,
      productName: p.productName,
      paidAmount: p.pretaxAmount.toFixed(2),
      grossAmount: p.pretaxGrossAmount.toFixed(2),
      subscriptionType: p.subscriptionType || null,
    }));

    const resourcePackagesJson = resourcePackages.map((r) => ({
      instanceId: r.instanceId,
      productCode: r.productCode,
      packageType: r.packageType,
      region: r.region,
      totalAmount: String(r.totalAmount),
      remainingAmount: String(r.remainingAmount),
      unit: r.unit,
      status: r.status,
      effectiveTime: r.effectiveTime,
      expiryTime: r.expiryTime,
      applicableProducts: r.applicableProducts,
      remark: r.remark,
    }));

    const subscriptionsJson = subscriptions.map((s) => ({
      instanceId: s.instanceId,
      productCode: s.productCode,
      productName: s.productName,
      paidAmount: s.pretaxAmount.toFixed(2),
      billingType: s.billingType,
      // 用 nickName 或 region 作为辅助；真实到期日 BSS 月账单不直返，留 null 等阶段二补
      expireTime: null,
    }));

    const baseData = {
      vendor: CLOUD_VENDOR.ALIYUN,
      billingCycle,
      accountId,
      balanceAvailable: balance ? new Prisma.Decimal(balance.availableAmount.toFixed(2)) : null,
      balanceCash: balance ? new Prisma.Decimal(balance.availableCashAmount.toFixed(2)) : null,
      mtdAmount: new Prisma.Decimal(mtdAmount.toFixed(2)),
      mtdGrossAmount: new Prisma.Decimal(mtdGross.toFixed(2)),
      productBills: productBillsJson as unknown as Prisma.InputJsonValue,
      resourcePackages: resourcePackagesJson as unknown as Prisma.InputJsonValue,
      subscriptions: subscriptionsJson as unknown as Prisma.InputJsonValue,
      rawPayload: {
        instanceBillsCount: instanceBills.length,
        unseenProductCodes: unseen,
      } as unknown as Prisma.InputJsonValue,
    };

    await prisma.cloudBillSnapshot.upsert({
      where: {
        vendor_snapshotDate: {
          vendor: CLOUD_VENDOR.ALIYUN,
          snapshotDate: snapshotDateObj,
        },
      },
      create: {
        ...baseData,
        snapshotDate: snapshotDateObj,
      },
      update: baseData,
    });
    console.log(`[snapshot] 已写入 CloudBillSnapshot ${snapshotDate}`);
  } else {
    console.log('[snapshot] dryRun 跳过 DB 写入');
  }

  return {
    snapshotDate,
    billingCycle,
    balance,
    productBills,
    resourcePackages,
    subscriptions,
    instanceBills,
    unseenProductCodes: unseen,
  };
}
