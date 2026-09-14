import {
  CLOUD_ALERT_CATEGORY,
  CLOUD_ALERT_LEVEL,
  CLOUD_ALERT_STATUS,
  CLOUD_METRIC_NAME,
  CLOUD_PRODUCT_CODE,
  CLOUD_VENDOR,
} from '@ky-azeroth/shared';
import { Prisma, PrismaClient } from '@prisma/client';

import type { BssClientWrapper } from '../aliyun/bss-client';
import type { ProductBillRow } from '../aliyun/types';
import {
  daysAgoBeijing,
  daysUntil,
  parseDateOnly,
  pickDatePart,
  previousCycle,
} from '../utils/date';
import type { SnapshotResult } from './sync-snapshot';

/** 阈值常量 */
const BALANCE_LOW_THRESHOLD = 100;
const PACKAGE_LOW_RATIO = 0.2;
const PACKAGE_EXPIRING_DAYS = 30;
const SPIKE_RATIO = 1.5; // 1.5 倍 = 50% 增长
const SPIKE_MIN_AMOUNT = 200;

export interface AlertEngineOptions {
  prisma: PrismaClient;
  bss: BssClientWrapper;
  snapshot: SnapshotResult;
  dryRun: boolean;
}

export interface AlertEngineResult {
  created: number;
  resolved: number;
  totalActive: number;
}

interface PendingAlert {
  level: string;
  category: string;
  title: string;
  message: string;
  relatedResource: string | null;
  payload: Record<string, unknown>;
}

/**
 * 比对快照生成 / 恢复 / 跳过预警。
 *
 * 规则：
 *   - balance_low（P0）: 余额 < ¥100
 *   - package_low（P1）: 资源包余量 / 总量 < 20%
 *   - package_expiring（P1）: 资源包 30 天内到期
 *   - subscription_expiring（P1）: 订阅类实例 30 天内到期
 *   - package_runout_early（P1）: 资源包预测耗尽日 < 实际到期日（需要 usage 有值）
 *   - spike_anomaly（P1）: 当月扣费环比上月 > 50% 且 > ¥200
 *
 * 去重 / 恢复策略：
 *   - 按 (category, relatedResource, status=active) 唯一
 *   - 同一资源已有 active alert 时跳过新增（不重复推送）
 *   - 当前快照不再触发但仍 active 的 alert，自动 status=resolved
 */
export async function runAlertEngine(options: AlertEngineOptions): Promise<AlertEngineResult> {
  const { prisma, bss, snapshot, dryRun } = options;

  const pending: PendingAlert[] = [];

  // ---------------- balance_low ----------------
  if (snapshot.balance && snapshot.balance.availableAmount < BALANCE_LOW_THRESHOLD) {
    pending.push({
      level: CLOUD_ALERT_LEVEL.P0,
      category: CLOUD_ALERT_CATEGORY.BALANCE_LOW,
      title: `阿里云账户余额不足 ¥${BALANCE_LOW_THRESHOLD}`,
      message: `当前可用余额 ¥${snapshot.balance.availableAmount.toFixed(2)}，低于阈值 ¥${BALANCE_LOW_THRESHOLD}。请尽快充值，避免按量产品扣费失败导致服务中断。`,
      relatedResource: 'account',
      payload: {
        availableAmount: snapshot.balance.availableAmount,
        availableCashAmount: snapshot.balance.availableCashAmount,
        threshold: BALANCE_LOW_THRESHOLD,
      },
    });
  }

  const now = new Date();

  // ---------------- package_low / package_expiring / package_runout_early ----------------
  // 预先按 instanceId 抓最近 7 天的 fc CU 使用量（仅 FC 资源包用得上 runout 预测）
  let fcDailyAvgByInstance = new Map<string, number>();
  try {
    const since = parseDateOnly(daysAgoBeijing(7, now));
    const today = parseDateOnly(daysAgoBeijing(0, now));
    const fcUsages = await prisma.cloudUsageMetric.findMany({
      where: {
        vendor: CLOUD_VENDOR.ALIYUN,
        productCode: CLOUD_PRODUCT_CODE.FC,
        metricName: CLOUD_METRIC_NAME.FC_CU_USAGE,
        metricDate: { gte: since, lt: today },
      },
      select: { value: true, metricDate: true, instanceId: true },
    });
    // FC 资源包不是按函数分摊，是账户级。所以把 7 日总量 / 7 作为账户级日均 CU 消耗。
    let total = 0;
    const dateSet = new Set<string>();
    for (const u of fcUsages) {
      total += Number(u.value);
      dateSet.add(u.metricDate.toISOString().slice(0, 10));
    }
    const daysObserved = Math.max(1, dateSet.size);
    const avgPerDayCu = total / daysObserved;
    // FC 资源包是账户级，所有 fc 包共享一个日均。用 "*" key
    fcDailyAvgByInstance.set('*', avgPerDayCu);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[alert] 计算 FC 日均失败: ${msg}`);
    fcDailyAvgByInstance = new Map<string, number>();
  }

  for (const pkg of snapshot.resourcePackages) {
    if (pkg.status && pkg.status !== 'Available') continue;
    const total = pkg.totalAmount;
    const remain = pkg.remainingAmount;
    const productCode = pkg.productCode;
    const resourceKey = `${productCode}:${pkg.instanceId}`;

    // 1. 余量低
    if (total > 0) {
      const ratio = remain / total;
      if (ratio < PACKAGE_LOW_RATIO) {
        pending.push({
          level: CLOUD_ALERT_LEVEL.P1,
          category: CLOUD_ALERT_CATEGORY.PACKAGE_LOW,
          title: `${productCode} 资源包余量低于 ${Math.round(PACKAGE_LOW_RATIO * 100)}%`,
          message: `资源包 ${pkg.instanceId} 余量 ${remain}/${total}${pkg.unit ?? ''}（${(ratio * 100).toFixed(1)}%），低于阈值。建议尽快补购或评估业务流量。`,
          relatedResource: resourceKey,
          payload: {
            instanceId: pkg.instanceId,
            productCode,
            totalAmount: total,
            remainingAmount: remain,
            unit: pkg.unit,
            ratio,
          },
        });
      }
    }

    // 2. 到期临近
    const daysLeft = daysUntil(pkg.expiryTime, now);
    if (daysLeft !== null && daysLeft >= 0 && daysLeft <= PACKAGE_EXPIRING_DAYS) {
      pending.push({
        level: CLOUD_ALERT_LEVEL.P1,
        category: CLOUD_ALERT_CATEGORY.PACKAGE_EXPIRING,
        title: `${productCode} 资源包 ${daysLeft} 天后到期`,
        message: `资源包 ${pkg.instanceId} 将于 ${pickDatePart(pkg.expiryTime) ?? '?'} 到期（剩 ${daysLeft} 天）。请评估续费需求。`,
        relatedResource: resourceKey,
        payload: {
          instanceId: pkg.instanceId,
          productCode,
          expiryTime: pkg.expiryTime,
          daysLeft,
        },
      });
    }

    // 3. 预测耗尽日早于到期日（仅 FC，且日均 > 0）
    if (productCode === CLOUD_PRODUCT_CODE.FC && pkg.expiryTime && remain > 0) {
      const dailyCu = fcDailyAvgByInstance.get('*') ?? 0;
      if (dailyCu > 0) {
        const daysToRunout = remain / dailyCu;
        if (daysToRunout < (daysLeft ?? Infinity) && daysToRunout < 365) {
          const projectedRunoutDate = new Date(now.getTime() + daysToRunout * 86400 * 1000)
            .toISOString()
            .slice(0, 10);
          pending.push({
            level: CLOUD_ALERT_LEVEL.P1,
            category: CLOUD_ALERT_CATEGORY.PACKAGE_RUNOUT_EARLY,
            title: `${productCode} 资源包预测在到期前耗尽`,
            message: `资源包 ${pkg.instanceId} 余量 ${remain}${pkg.unit ?? ''}，按近 7 日均 ${dailyCu.toFixed(0)} CU/天，约在 ${projectedRunoutDate} 耗尽，早于到期日 ${pickDatePart(pkg.expiryTime) ?? '?'}。建议提前补包。`,
            relatedResource: resourceKey,
            payload: {
              instanceId: pkg.instanceId,
              productCode,
              remainingAmount: remain,
              dailyAvg: dailyCu,
              projectedRunoutDate,
              expiryTime: pkg.expiryTime,
              daysToRunout,
              daysLeft,
            },
          });
        }
      }
    }
  }

  // ---------------- subscription_expiring ----------------
  // 月度账单不直接返回订阅到期日。这里按"有 servicePeriod 字段"的实例视为候选，
  // V1 暂以"距离当月底剩余天数"做粗略提示；真实到期日需要从控制台或单独接口补，
  // 故仅当 nickName 含 'expire' 等关键字 或 servicePeriod 解析成功时才告警。
  for (const sub of snapshot.subscriptions) {
    // servicePeriod 形如 "1 月" / "1 年"，BSS 月账单的到期日不在响应里，跳过。
    // 仅对存在到期信息的情况告警（V1 后续 phase 补 DescribeRenewalInstance）。
    // 该实现保留接口位以便日后扩展。
    void sub;
  }

  // ---------------- spike_anomaly ----------------
  try {
    const prevCycle = previousCycle(snapshot.billingCycle);
    const prevRows: ProductBillRow[] = await bss.queryAccountBill(prevCycle, {
      groupByProduct: true,
    });
    const prevByProduct = new Map<string, number>();
    for (const r of prevRows) {
      prevByProduct.set(r.productCode, (prevByProduct.get(r.productCode) ?? 0) + r.pretaxAmount);
    }

    // 整体环比
    const prevTotal = Array.from(prevByProduct.values()).reduce((s, v) => s + v, 0);
    const curTotal = snapshot.productBills.reduce((s, p) => s + p.pretaxAmount, 0);
    if (prevTotal > 0 && curTotal > SPIKE_MIN_AMOUNT && curTotal / prevTotal > SPIKE_RATIO) {
      const ratioStr = ((curTotal / prevTotal - 1) * 100).toFixed(1);
      pending.push({
        level: CLOUD_ALERT_LEVEL.P1,
        category: CLOUD_ALERT_CATEGORY.SPIKE_ANOMALY,
        title: `${snapshot.billingCycle} 总扣费环比上月暴增 ${ratioStr}%`,
        message: `${snapshot.billingCycle} 累计 ¥${curTotal.toFixed(2)}，上月同期 ¥${prevTotal.toFixed(2)}。请排查近期资源变更。`,
        relatedResource: `total:${snapshot.billingCycle}`,
        payload: {
          billingCycle: snapshot.billingCycle,
          previousCycle: prevCycle,
          currentTotal: curTotal,
          previousTotal: prevTotal,
          ratio: curTotal / prevTotal,
        },
      });
    }

    // 单产品环比（每个有暴增的产品都触发一条）
    for (const p of snapshot.productBills) {
      const prev = prevByProduct.get(p.productCode) ?? 0;
      const cur = p.pretaxAmount;
      if (prev > 0 && cur > SPIKE_MIN_AMOUNT && cur / prev > SPIKE_RATIO) {
        const ratioStr = ((cur / prev - 1) * 100).toFixed(1);
        pending.push({
          level: CLOUD_ALERT_LEVEL.P1,
          category: CLOUD_ALERT_CATEGORY.SPIKE_ANOMALY,
          title: `${p.productName} 扣费环比上月暴增 ${ratioStr}%`,
          message: `${snapshot.billingCycle} ${p.productName} 扣费 ¥${cur.toFixed(2)}，上月 ¥${prev.toFixed(2)}。请检查相关实例。`,
          relatedResource: `product:${p.productCode}:${snapshot.billingCycle}`,
          payload: {
            productCode: p.productCode,
            productName: p.productName,
            billingCycle: snapshot.billingCycle,
            previousCycle: prevCycle,
            currentAmount: cur,
            previousAmount: prev,
            ratio: cur / prev,
          },
        });
      }
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[alert] spike 环比拉取失败: ${msg}`);
  }

  // ---------------- 应用 dedup + auto-resolve ----------------
  console.log(`[alert] 待评估 ${pending.length} 条规则触发`);

  // 当前活跃 alerts
  const activeAlerts = await prisma.cloudAlert.findMany({
    where: {
      vendor: CLOUD_VENDOR.ALIYUN,
      status: CLOUD_ALERT_STATUS.ACTIVE,
    },
    select: { id: true, category: true, relatedResource: true },
  });

  const activeKeys = new Map<string, string>();
  for (const a of activeAlerts) {
    activeKeys.set(`${a.category}::${a.relatedResource ?? ''}`, a.id);
  }
  const stillFiringKeys = new Set<string>();

  let created = 0;
  for (const p of pending) {
    const key = `${p.category}::${p.relatedResource ?? ''}`;
    stillFiringKeys.add(key);
    if (activeKeys.has(key)) {
      // 已存在 active，跳过创建（payload 不更新——保留首次触发的快照）
      continue;
    }
    if (!dryRun) {
      await prisma.cloudAlert.create({
        data: {
          vendor: CLOUD_VENDOR.ALIYUN,
          level: p.level,
          category: p.category,
          title: p.title,
          message: p.message,
          relatedResource: p.relatedResource,
          status: CLOUD_ALERT_STATUS.ACTIVE,
          payload: p.payload as unknown as Prisma.InputJsonValue,
        },
      });
    }
    created += 1;
  }

  // auto-resolve：active 但本次未触发
  let resolved = 0;
  const resolvedAt = new Date();
  for (const [key, id] of activeKeys.entries()) {
    if (stillFiringKeys.has(key)) continue;
    if (!dryRun) {
      await prisma.cloudAlert.update({
        where: { id },
        data: {
          status: CLOUD_ALERT_STATUS.RESOLVED,
          resolvedAt,
          resolutionNote: '触发条件已自动消失（来自每日 sync 自动恢复）',
        },
      });
    }
    resolved += 1;
  }

  console.log(`[alert] 新增 ${created} 条 / 自动恢复 ${resolved} 条`);

  const totalActive = await prisma.cloudAlert
    .count({
      where: { vendor: CLOUD_VENDOR.ALIYUN, status: CLOUD_ALERT_STATUS.ACTIVE },
    })
    .catch(() => activeKeys.size + created - resolved);

  return { created, resolved, totalActive };
}
