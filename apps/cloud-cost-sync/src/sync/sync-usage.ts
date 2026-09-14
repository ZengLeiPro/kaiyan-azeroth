import { CLOUD_METRIC_NAME, CLOUD_PRODUCT_CODE, CLOUD_VENDOR } from '@ky-azeroth/shared';
import { Prisma, PrismaClient } from '@prisma/client';

import type { BssClientWrapper } from '../aliyun/bss-client';
import type { CmsClientWrapper } from '../aliyun/cms-client';
import type { CmsDataPoint } from '../aliyun/types';
import {
  beijingEndOfDayUtcMs,
  beijingMidnightUtcMs,
  daysAgoBeijing,
  parseDateOnly,
} from '../utils/date';

export interface SyncUsageOptions {
  bss: BssClientWrapper;
  cms: CmsClientWrapper;
  prisma: PrismaClient;
  lookbackDays: number;
  dryRun: boolean;
}

export interface UsageResult {
  /** 写入条数 */
  count: number;
  /** 按 (productCode, metricName) 分组的统计 */
  byMetric: Record<string, number>;
}

/** 把时间戳归到北京时间的 YYYY-MM-DD */
function bjDateOfTimestamp(ms: number): string {
  const d = new Date(ms + 8 * 3600 * 1000);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

interface PointAggregate {
  vendor: string;
  productCode: string;
  metricName: string;
  instanceId: string | null;
  metricDate: string;
  value: number;
  unit: string;
  meta: Record<string, unknown>;
}

/** 把 CMS 时序点按 (instanceId, dimensionKey, day) 聚合 */
function aggregateCmsPoints(
  points: CmsDataPoint[],
  config: {
    productCode: string;
    metricName: string;
    unit: string;
    /** 用哪个字段作为 instanceId */
    instanceKey: keyof CmsDataPoint;
    /** 把那些维度写入 meta */
    metaKeys?: Array<keyof CmsDataPoint>;
    /** 取 Value / Sum / Average */
    valueField?: 'Value' | 'Sum' | 'Average' | 'Maximum';
  }
): PointAggregate[] {
  const map = new Map<string, PointAggregate>();
  const valueField = config.valueField ?? 'Value';
  const metaKeys = config.metaKeys ?? [];

  for (const pt of points) {
    const ts = typeof pt.timestamp === 'number' ? pt.timestamp : Number(pt.timestamp ?? 0);
    if (!Number.isFinite(ts) || ts <= 0) continue;
    const day = bjDateOfTimestamp(ts);
    const instanceRaw = pt[config.instanceKey];
    const instanceId =
      typeof instanceRaw === 'string' && instanceRaw.length > 0 ? instanceRaw : null;
    const valueRaw = pt[valueField];
    const value = typeof valueRaw === 'number' ? valueRaw : Number(valueRaw ?? 0);
    if (!Number.isFinite(value)) continue;

    const key = `${instanceId ?? '_'}::${day}`;
    const existing = map.get(key);
    if (existing) {
      existing.value += value;
    } else {
      const meta: Record<string, unknown> = {};
      for (const k of metaKeys) {
        const v = pt[k];
        if (typeof v === 'string' && v.length > 0) meta[k as string] = v;
      }
      map.set(key, {
        vendor: CLOUD_VENDOR.ALIYUN,
        productCode: config.productCode,
        metricName: config.metricName,
        instanceId,
        metricDate: day,
        value,
        unit: config.unit,
        meta,
      });
    }
  }

  return Array.from(map.values());
}

/**
 * 抓取并写入 CloudUsageMetric。
 *
 * 抓取范围：北京时间今天回溯 lookbackDays 天（默认 7）。
 * 写入策略：按 (vendor, productCode, metricName, instanceId, metricDate) upsert。
 *
 * V1 覆盖：
 *   - FC BSS 日账单实际 CU（资源包抵扣量 + 按量用量）
 *   - FC FunctionTotalInvocations（调用次数）
 *   - FC FunctionAvgDuration（平均耗时，ms）
 *   - OSS 存储量（MeteringStorageUtilization）
 *   - OSS 外网流量（InternetSend）
 *   - 百炼 token / 调用次数（如果开放了 acs_bailian）
 *
 * 注：ECS 自定义流量（wg0/eth0）需要部署内 agent 上报，V1 不实现。
 */
export async function syncUsage(options: SyncUsageOptions): Promise<UsageResult> {
  const { bss, cms, prisma, lookbackDays, dryRun } = options;

  // 时间窗口：从 N 天前北京 00:00 到今天北京 23:59:59.999
  const startDate = daysAgoBeijing(Math.max(1, lookbackDays - 1));
  const endDate = daysAgoBeijing(0);
  const startMs = beijingMidnightUtcMs(startDate);
  const endMs = beijingEndOfDayUtcMs(endDate);

  console.log(`[usage] 拉取窗口 ${startDate} ~ ${endDate}`);

  const aggregates: PointAggregate[] = [];
  const byMetric: Record<string, number> = {};
  const exactFcUsageDates = new Set<string>();

  // --- FC 实际 CU ---
  // CMS FunctionCost 的单位是 MB·ms，只代表原始资源时长，不能直接换算成账单 CU。
  // 精确 CU 必须以 BSS 日账单为准：资源包抵扣量 + 未覆盖的按量用量。
  for (
    let dayMs = parseDateOnly(startDate).getTime();
    dayMs <= parseDateOnly(endDate).getTime();
    dayMs += 86400 * 1000
  ) {
    const day = new Date(dayMs).toISOString().slice(0, 10);
    try {
      const rows = await bss.describeInstanceBill(day.slice(0, 7), {
        granularity: 'DAILY',
        billingDate: day,
        productCode: CLOUD_PRODUCT_CODE.FC,
        isBillingItem: true,
      });
      const byFunction = new Map<string, { value: number; region: string | null }>();
      for (const row of rows) {
        if (row.billingItemCode !== 'CUUsage') continue;
        const match = row.instanceId.match(/functions\/([^/;]+)/);
        const functionName = match?.[1];
        if (!functionName) continue;
        const value = row.usage + row.deductedByResourcePackage;
        if (!Number.isFinite(value) || value <= 0) continue;
        const existing = byFunction.get(functionName);
        if (existing) {
          existing.value += value;
        } else {
          byFunction.set(functionName, { value, region: row.region });
        }
      }
      for (const [functionName, value] of byFunction) {
        aggregates.push({
          vendor: CLOUD_VENDOR.ALIYUN,
          productCode: CLOUD_PRODUCT_CODE.FC,
          metricName: CLOUD_METRIC_NAME.FC_CU_USAGE,
          instanceId: functionName,
          metricDate: day,
          value: value.value,
          unit: 'CU',
          meta: {
            functionName,
            source: 'bss_daily_bill',
            ...(value.region ? { region: value.region } : {}),
          },
        });
      }
      exactFcUsageDates.add(day);
      console.log(`[usage] FC BSS ${day}: ${byFunction.size} 个函数`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[usage] FC BSS ${day} 拉取失败: ${msg}`);
    }
  }

  // --- FC 运行指标 ---
  const fcMetrics: Array<{
    metric: string;
    name: string;
    unit: string;
  }> = [
    { metric: 'FunctionTotalInvocations', name: CLOUD_METRIC_NAME.FC_INVOCATION, unit: 'count' },
    { metric: 'FunctionAvgDuration', name: CLOUD_METRIC_NAME.FC_DURATION, unit: 'ms' },
  ];
  for (const m of fcMetrics) {
    try {
      const points = await cms.describeMetricList({
        namespace: 'acs_fc',
        metricName: m.metric,
        startTime: startMs,
        endTime: endMs,
        period: 3600,
      });
      const valueField: 'Value' | 'Average' =
        m.metric === 'FunctionAvgDuration' ? 'Average' : 'Value';
      // FunctionAvgDuration 是平均值，不应该简单 sum；这里按"每日均值"聚合（多个 1h 点取均值）
      if (valueField === 'Average') {
        const map = new Map<string, { sum: number; cnt: number; meta: Record<string, unknown> }>();
        for (const pt of points) {
          const ts = Number(pt.timestamp ?? 0);
          if (!Number.isFinite(ts) || ts <= 0) continue;
          const day = bjDateOfTimestamp(ts);
          const fn = typeof pt.functionName === 'string' ? pt.functionName : null;
          if (!fn) continue;
          const v =
            typeof pt.Average === 'number' ? pt.Average : Number(pt.Average ?? pt.Value ?? 0);
          if (!Number.isFinite(v) || v <= 0) continue;
          const key = `${fn}::${day}`;
          const existing = map.get(key);
          if (existing) {
            existing.sum += v;
            existing.cnt += 1;
          } else {
            map.set(key, {
              sum: v,
              cnt: 1,
              meta: {
                functionName: fn,
                ...(typeof pt.region === 'string' ? { region: pt.region } : {}),
              },
            });
          }
        }
        for (const [k, v] of map.entries()) {
          const parts = k.split('::');
          const fn = parts[0] ?? '';
          const day = parts[1] ?? '';
          if (!day) continue;
          aggregates.push({
            vendor: CLOUD_VENDOR.ALIYUN,
            productCode: CLOUD_PRODUCT_CODE.FC,
            metricName: m.name,
            instanceId: fn || null,
            metricDate: day,
            value: v.sum / v.cnt,
            unit: m.unit,
            meta: v.meta,
          });
        }
      } else {
        const agg = aggregateCmsPoints(points, {
          productCode: CLOUD_PRODUCT_CODE.FC,
          metricName: m.name,
          unit: m.unit,
          instanceKey: 'functionName',
          metaKeys: ['functionName', 'region', 'serviceName'],
          valueField: 'Value',
        });
        aggregates.push(...agg);
      }
      console.log(`[usage] FC ${m.metric}: 原始 ${points.length} 点`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[usage] FC ${m.metric} 拉取失败: ${msg}`);
    }
  }

  // --- OSS ---
  const ossMetrics: Array<{
    metric: string;
    name: string;
    unit: string;
  }> = [
    {
      metric: 'MeteringStorageUtilization',
      name: CLOUD_METRIC_NAME.OSS_STORAGE_SIZE,
      unit: 'bytes',
    },
    { metric: 'InternetSend', name: CLOUD_METRIC_NAME.OSS_TRAFFIC_OUT, unit: 'bytes' },
    { metric: 'InternetRecv', name: CLOUD_METRIC_NAME.OSS_TRAFFIC_IN, unit: 'bytes' },
  ];
  for (const m of ossMetrics) {
    try {
      const points = await cms.describeMetricList({
        namespace: 'acs_oss',
        metricName: m.metric,
        startTime: startMs,
        endTime: endMs,
        period: 3600,
      });
      // 对存储量取每日最大（峰值）；流量取每日 sum
      if (m.metric === 'MeteringStorageUtilization') {
        const map = new Map<string, { max: number; meta: Record<string, unknown> }>();
        for (const pt of points) {
          const ts = Number(pt.timestamp ?? 0);
          if (!Number.isFinite(ts) || ts <= 0) continue;
          const day = bjDateOfTimestamp(ts);
          const bucket = typeof pt.bucket === 'string' ? pt.bucket : null;
          const v =
            typeof pt.Maximum === 'number'
              ? pt.Maximum
              : Number(pt.Maximum ?? pt.Value ?? pt.Average ?? 0);
          if (!Number.isFinite(v)) continue;
          const key = `${bucket ?? '_'}::${day}`;
          const existing = map.get(key);
          if (existing) {
            if (v > existing.max) existing.max = v;
          } else {
            map.set(key, {
              max: v,
              meta: bucket ? { bucket } : {},
            });
          }
        }
        for (const [k, v] of map.entries()) {
          const parts = k.split('::');
          const bucket = parts[0] === '_' ? null : (parts[0] ?? null);
          const day = parts[1] ?? '';
          if (!day) continue;
          aggregates.push({
            vendor: CLOUD_VENDOR.ALIYUN,
            productCode: CLOUD_PRODUCT_CODE.OSS,
            metricName: m.name,
            instanceId: bucket,
            metricDate: day,
            value: v.max,
            unit: m.unit,
            meta: v.meta,
          });
        }
      } else {
        const agg = aggregateCmsPoints(points, {
          productCode: CLOUD_PRODUCT_CODE.OSS,
          metricName: m.name,
          unit: m.unit,
          instanceKey: 'bucket',
          metaKeys: ['bucket'],
          valueField: 'Value',
        });
        aggregates.push(...agg);
      }
      console.log(`[usage] OSS ${m.metric}: 原始 ${points.length} 点`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[usage] OSS ${m.metric} 拉取失败: ${msg}`);
    }
  }

  // --- 百炼（如有权限） ---
  // namespace acs_bailian 仅在用户开通了对应模型 / CMS 上报后才有数据，失败静默
  const bailianMetrics: Array<{ metric: string; name: string; unit: string }> = [
    { metric: 'TotalTokensInput', name: CLOUD_METRIC_NAME.BAILIAN_TOKEN_INPUT, unit: 'token' },
    { metric: 'TotalTokensOutput', name: CLOUD_METRIC_NAME.BAILIAN_TOKEN_OUTPUT, unit: 'token' },
    { metric: 'TotalCalls', name: CLOUD_METRIC_NAME.BAILIAN_CALL_COUNT, unit: 'count' },
  ];
  for (const m of bailianMetrics) {
    try {
      const points = await cms.describeMetricList({
        namespace: 'acs_bailian',
        metricName: m.metric,
        startTime: startMs,
        endTime: endMs,
        period: 3600,
      });
      const agg = aggregateCmsPoints(points, {
        productCode: CLOUD_PRODUCT_CODE.BAILIAN,
        metricName: m.name,
        unit: m.unit,
        instanceKey: 'modelId',
        metaKeys: ['modelId', 'modelType'],
        valueField: 'Value',
      });
      aggregates.push(...agg);
      console.log(`[usage] 百炼 ${m.metric}: 原始 ${points.length} 点`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[usage] 百炼 ${m.metric} 拉取失败（可能未开通）: ${msg}`);
    }
  }

  // 写入
  if (dryRun) {
    console.log(`[usage] dryRun 跳过 DB 写入，累计 ${aggregates.length} 条聚合`);
  } else {
    // 清掉同日期旧版 CMS FunctionCost 伪 CU，避免已停用函数的脏数据残留。
    for (const day of exactFcUsageDates) {
      await prisma.cloudUsageMetric.deleteMany({
        where: {
          vendor: CLOUD_VENDOR.ALIYUN,
          productCode: CLOUD_PRODUCT_CODE.FC,
          metricName: CLOUD_METRIC_NAME.FC_CU_USAGE,
          metricDate: parseDateOnly(day),
        },
      });
    }
    for (const a of aggregates) {
      const metricDateObj = parseDateOnly(a.metricDate);
      const data = {
        vendor: a.vendor,
        productCode: a.productCode,
        metricName: a.metricName,
        instanceId: a.instanceId,
        metricDate: metricDateObj,
        value: new Prisma.Decimal(a.value.toString()),
        unit: a.unit,
        meta: a.meta as unknown as Prisma.InputJsonValue,
      };
      // 复合 unique，instanceId 可能为 null。Postgres 中 NULL 不参与 unique，需要手动判断
      // 这里用 deleteMany + create 模拟 upsert（仅在 instanceId=null 时；其他用 upsert）
      if (a.instanceId === null) {
        await prisma.cloudUsageMetric.deleteMany({
          where: {
            vendor: a.vendor,
            productCode: a.productCode,
            metricName: a.metricName,
            instanceId: null,
            metricDate: metricDateObj,
          },
        });
        await prisma.cloudUsageMetric.create({ data });
      } else {
        await prisma.cloudUsageMetric.upsert({
          where: {
            uniq_usage_metric: {
              vendor: a.vendor,
              productCode: a.productCode,
              metricName: a.metricName,
              instanceId: a.instanceId,
              metricDate: metricDateObj,
            },
          },
          create: data,
          update: data,
        });
      }
      byMetric[a.metricName] = (byMetric[a.metricName] ?? 0) + 1;
    }
    console.log(`[usage] 已写入 ${aggregates.length} 条 CloudUsageMetric`);
  }

  return { count: aggregates.length, byMetric };
}
