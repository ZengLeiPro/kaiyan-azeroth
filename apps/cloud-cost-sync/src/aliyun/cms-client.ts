import CmsClient, { DescribeMetricListRequest } from '@alicloud/cms20190101';
import { Config as OpenApiConfig } from '@alicloud/openapi-client';
import { RuntimeOptions } from '@alicloud/tea-util';

import { sleep } from '../utils/date';
import type { CmsDataPoint } from './types';

export interface CmsClientOptions {
  accessKeyId: string;
  accessKeySecret: string;
  endpoint: string;
  throttleMs?: number;
  /** 单次返回点数上限 */
  length?: number;
}

export interface DescribeMetricArgs {
  namespace: string;
  metricName: string;
  /** 毫秒时间戳 */
  startTime: number;
  /** 毫秒时间戳 */
  endTime: number;
  /** 聚合周期（秒），FC 支持 5/60/3600 */
  period: number | string;
  /** 维度数组：每个对象会被序列化为 JSON 字符串传入 */
  dimensions?: Array<Record<string, string>>;
}

/**
 * CMS（云监控）API 客户端封装。
 *
 * - 仅暴露 describeMetricList，因为本应用主要消费时序指标
 * - 自动处理 next_token 分页
 * - 数据点统一返回为扁平对象数组（datapoints 是 JSON 字符串，我们解析）
 */
export class CmsClientWrapper {
  private readonly client: CmsClient;
  private readonly throttleMs: number;
  private readonly length: number;
  private readonly runtime: RuntimeOptions;

  constructor(opts: CmsClientOptions) {
    this.client = new CmsClient(
      new OpenApiConfig({
        accessKeyId: opts.accessKeyId,
        accessKeySecret: opts.accessKeySecret,
        endpoint: opts.endpoint,
      })
    );
    this.throttleMs = opts.throttleMs ?? 150;
    this.length = opts.length ?? 2000;
    this.runtime = new RuntimeOptions({
      autoretry: true,
      maxAttempts: 3,
      readTimeout: 30_000,
      connectTimeout: 10_000,
    });
  }

  async describeMetricList(args: DescribeMetricArgs): Promise<CmsDataPoint[]> {
    const all: CmsDataPoint[] = [];
    let nextToken: string | undefined = undefined;
    const period = String(args.period);
    const dimensionsStr =
      args.dimensions && args.dimensions.length > 0 ? JSON.stringify(args.dimensions) : undefined;

    for (let safety = 0; safety < 200; safety++) {
      await sleep(this.throttleMs);
      const req = new DescribeMetricListRequest({
        namespace: args.namespace,
        metricName: args.metricName,
        startTime: String(args.startTime),
        endTime: String(args.endTime),
        period,
        length: String(this.length),
        ...(dimensionsStr ? { dimensions: dimensionsStr } : {}),
        ...(nextToken ? { nextToken } : {}),
      });
      const resp = await this.client.describeMetricListWithOptions(req, this.runtime);
      const body = resp.body;
      if (body?.datapoints && typeof body.datapoints === 'string') {
        try {
          const arr = JSON.parse(body.datapoints) as CmsDataPoint[];
          if (Array.isArray(arr)) all.push(...arr);
        } catch {
          // 阿里云偶尔返回非 JSON（空字符串），忽略
        }
      }
      nextToken = body?.nextToken ?? undefined;
      if (!nextToken) break;
    }
    return all;
  }
}
