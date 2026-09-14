/**
 * azeroth cloud-usage-metrics —— 用量时序子命令组（追挂模式）
 *
 * 设计说明：
 *   - cloud-usage-metrics 的 list/get 已由自动 CRUD 注册。
 *   - 本文件追挂 1 条非标聚合 endpoint：
 *     - GET /cloud-usage-metrics/series   按维度聚合后的时序数据（前端绘图用）
 *   - 字段（来自 queryCloudUsageSeriesSchema）：维度/时间范围/采样粒度等。
 */

import {
  type CloudUsageSeriesResponseOutput,
  queryCloudUsageSeriesSchema,
} from '@ky-azeroth/shared';
import { Command } from 'commander';

import { request } from '../client.js';
import { fatal, output, parseJsonWithSchema } from '../utils.js';

export function registerCloudUsageMetricsExtras(cloudUsageMetricsCmd: Command): void {
  const program = cloudUsageMetricsCmd.parent;
  const getFormat = (): string => (program?.opts()['format'] as string | undefined) ?? 'json';

  cloudUsageMetricsCmd
    .command('series')
    .description('用量时序聚合（GET /cloud-usage-metrics/series，按维度/粒度/时间范围）')
    .option(
      '--json <path>',
      'query JSON（与 queryCloudUsageSeriesSchema 对齐，必填，或 "-" 走 stdin）'
    )
    .action(async (opts: { json?: string }) => {
      if (!opts.json) {
        fatal(
          'Missing --json',
          '/series 接口要求 dimension/granularity/time range，参考 queryCloudUsageSeriesSchema'
        );
      }
      const params = parseJsonWithSchema(queryCloudUsageSeriesSchema, opts.json!, '--json');
      const result = await request<CloudUsageSeriesResponseOutput>(
        'GET',
        '/cloud-usage-metrics/series',
        undefined,
        params as unknown as Record<string, unknown>
      );
      output(result, getFormat());
    });
}
