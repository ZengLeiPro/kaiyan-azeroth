import BssClient, {
  DescribeInstanceBillRequest,
  type DescribeInstanceBillResponseBodyDataItems as DescribeInstanceBillItem,
  QueryAccountBillRequest,
  type QueryAccountBillResponseBodyDataItemsItem as QueryAccountBillItem,
  QueryResourcePackageInstancesRequest,
  type QueryResourcePackageInstancesResponseBodyDataInstancesInstance as ResourcePackageInstance,
} from '@alicloud/bssopenapi20171214';
import { Config as OpenApiConfig } from '@alicloud/openapi-client';
import { RuntimeOptions } from '@alicloud/tea-util';

import { sleep } from '../utils/date';
import type {
  AccountBalanceInfo,
  InstanceBillRow,
  ProductBillRow,
  ResourcePackageRow,
} from './types';

export interface BssClientOptions {
  accessKeyId: string;
  accessKeySecret: string;
  endpoint: string;
  /** 请求间隔毫秒（默认 150，防 10 QPS 限流） */
  throttleMs?: number;
}

/**
 * BSS（费用中心）API 客户端封装。
 *
 * - 全部方法做了 next_token / page_num 分页处理
 * - 每个出站请求 await sleep(throttleMs) 防 10 QPS 限流
 * - 失败时抛出包含原始 message 的 Error（由调用方决定要不要 swallow）
 */
export class BssClientWrapper {
  private readonly client: BssClient;
  private readonly throttleMs: number;
  private readonly runtime: RuntimeOptions;

  constructor(opts: BssClientOptions) {
    this.client = new BssClient(
      new OpenApiConfig({
        accessKeyId: opts.accessKeyId,
        accessKeySecret: opts.accessKeySecret,
        endpoint: opts.endpoint,
      })
    );
    this.throttleMs = opts.throttleMs ?? 150;
    this.runtime = new RuntimeOptions({
      autoretry: true,
      maxAttempts: 3,
      readTimeout: 30_000,
      connectTimeout: 10_000,
    });
  }

  /** 安全转 number（阿里云金额经常是字符串） */
  private toNum(v: number | string | null | undefined, fallback = 0): number {
    if (v === null || v === undefined || v === '') return fallback;
    const n = typeof v === 'number' ? v : Number(v);
    return Number.isFinite(n) ? n : fallback;
  }

  /** 1. 账户余额 */
  async queryAccountBalance(): Promise<AccountBalanceInfo> {
    await sleep(this.throttleMs);
    const resp = await this.client.queryAccountBalanceWithOptions(this.runtime);
    const data = resp.body?.data;
    if (!data) {
      throw new Error('QueryAccountBalance 返回空 data');
    }
    return {
      currency: data.currency ?? 'CNY',
      availableAmount: this.toNum(data.availableAmount),
      availableCashAmount: this.toNum(data.availableCashAmount),
      creditAmount: this.toNum(data.creditAmount),
    };
  }

  /** 2. 按产品当月账单（分页拉全部） */
  async queryAccountBill(
    cycle: string,
    options: { groupByProduct?: boolean } = {}
  ): Promise<ProductBillRow[]> {
    const pageSize = 300;
    const rows: ProductBillRow[] = [];
    let pageNum = 1;
    // 防御性上限：1000 个产品也足够（实际几十）
    for (let safety = 0; safety < 50; safety++) {
      await sleep(this.throttleMs);
      const req = new QueryAccountBillRequest({
        billingCycle: cycle,
        granularity: 'MONTHLY',
        isGroupByProduct: options.groupByProduct ?? true,
        pageNum,
        pageSize,
      });
      const resp = await this.client.queryAccountBillWithOptions(req, this.runtime);
      const data = resp.body?.data;
      const items: QueryAccountBillItem[] = data?.items?.item ?? [];
      for (const it of items) {
        rows.push({
          productCode: it.productCode ?? '',
          productName: it.productName ?? it.productCode ?? '',
          subscriptionType: it.subscriptionType ?? '',
          pretaxAmount: this.toNum(it.pretaxAmount),
          pretaxGrossAmount: this.toNum(it.pretaxGrossAmount),
          paymentAmount: this.toNum(it.paymentAmount),
        });
      }
      const total = data?.totalCount ?? rows.length;
      if (pageNum * pageSize >= total || items.length === 0) break;
      pageNum += 1;
    }
    return rows;
  }

  /** 3. 按实例账单（next_token 分页拉全部） */
  async describeInstanceBill(
    cycle: string,
    options: {
      isBillingItem?: boolean;
      productCode?: string;
      granularity?: 'MONTHLY' | 'DAILY';
      billingDate?: string;
    } = {}
  ): Promise<InstanceBillRow[]> {
    const granularity = options.granularity ?? 'MONTHLY';
    if (granularity === 'DAILY' && !options.billingDate) {
      throw new Error('DescribeInstanceBill DAILY 查询必须提供 billingDate');
    }
    const rows: InstanceBillRow[] = [];
    let nextToken: string | undefined = undefined;
    for (let safety = 0; safety < 500; safety++) {
      await sleep(this.throttleMs);
      const req = new DescribeInstanceBillRequest({
        billingCycle: cycle,
        granularity,
        ...(options.billingDate ? { billingDate: options.billingDate } : {}),
        isBillingItem: options.isBillingItem ?? false,
        maxResults: 300,
        ...(options.productCode ? { productCode: options.productCode } : {}),
        ...(nextToken ? { nextToken } : {}),
      });
      const resp = await this.client.describeInstanceBillWithOptions(req, this.runtime);
      const data = resp.body?.data;
      const items: DescribeInstanceBillItem[] = data?.items ?? [];
      for (const it of items) {
        rows.push({
          instanceId: (it.instanceID ?? it.instanceId ?? '').toString(),
          productCode: it.productCode ?? '',
          productName: it.productName ?? it.productCode ?? '',
          subscriptionType: it.subscriptionType ?? '',
          billingType: it.billingType ?? null,
          billingItemCode: it.billingItemCode ?? null,
          pretaxAmount: this.toNum(it.pretaxAmount),
          pretaxGrossAmount: this.toNum(it.pretaxGrossAmount),
          usage: this.toNum(it.usage),
          deductedByResourcePackage: this.toNum(it.deductedByResourcePackage),
          usageUnit: it.usageUnit ?? null,
          region: it.region ?? null,
          nickName: it.nickName ?? null,
          servicePeriod: it.servicePeriod ?? null,
          billingDate: it.billingDate ?? null,
        });
      }
      nextToken = data?.nextToken ?? undefined;
      if (!nextToken || items.length === 0) break;
    }
    return rows;
  }

  /** 4. 资源包列表（分页拉某产品的全部包） */
  async queryResourcePackageInstances(productCode: string): Promise<ResourcePackageRow[]> {
    const rows: ResourcePackageRow[] = [];
    const pageSize = 50;
    let pageNum = 1;
    for (let safety = 0; safety < 50; safety++) {
      await sleep(this.throttleMs);
      const req = new QueryResourcePackageInstancesRequest({
        productCode,
        pageNum,
        pageSize,
      });
      let resp;
      try {
        resp = await this.client.queryResourcePackageInstancesWithOptions(req, this.runtime);
      } catch (err: unknown) {
        // 没有资源包的产品会抛异常，不算错误
        const msg = err instanceof Error ? err.message : String(err);
        if (
          msg.includes('NotFound') ||
          msg.includes('NoData') ||
          msg.includes('InvalidParam') ||
          msg.includes('NotApplicable')
        ) {
          return rows;
        }
        throw err;
      }
      const data = resp.body?.data;
      const items: ResourcePackageInstance[] = data?.instances?.instance ?? [];
      for (const ins of items) {
        const ap = ins.applicableProducts;
        const applicable: string[] = Array.isArray((ap as { product?: string[] })?.product)
          ? ((ap as { product?: string[] }).product as string[])
          : [];
        rows.push({
          instanceId: (ins.instanceId ?? '').toString(),
          productCode,
          packageType: (ins.packageType as string | undefined) ?? null,
          region: (ins.region as string | undefined) ?? null,
          totalAmount: this.toNum(ins.totalAmount as string | number | undefined),
          remainingAmount: this.toNum(ins.remainingAmount as string | number | undefined),
          unit:
            ((ins.remainingAmountUnit as string | undefined) ??
              (ins.totalAmountUnit as string | undefined)) ||
            null,
          status: (ins.status as string | undefined) ?? null,
          effectiveTime: (ins.effectiveTime as string | undefined) ?? null,
          expiryTime: (ins.expiryTime as string | undefined) ?? null,
          applicableProducts: applicable,
          remark: (ins.remark as string | undefined) ?? null,
        });
      }
      const total = Number(data?.totalCount ?? rows.length);
      if (pageNum * pageSize >= total || items.length === 0) break;
      pageNum += 1;
    }
    return rows;
  }
}
