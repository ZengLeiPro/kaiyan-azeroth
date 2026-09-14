/**
 * azeroth cloud-bill-snapshots —— 云账单看板子命令组（追挂模式）
 *
 * 设计说明：
 *   - cloud-bill-snapshots 的 list/get 已由自动 CRUD 注册（readonly）。
 *   - 本文件追挂 3 条非标聚合 endpoint：
 *     - GET /cloud-bill-snapshots/latest               最新一条快照
 *     - GET /cloud-bill-snapshots/overview             成本概览（按月聚合）
 *     - GET /cloud-bill-snapshots/package-projection   资源包到期预测
 *   - 都是看板/聚合接口，CLI 提供后运维可脚本化对账。
 */

import {
  type CloudBillSnapshotResponseOutput,
  type CloudCostOverviewResponseOutput,
  type CloudPackageProjectionOutput,
  queryCloudCostOverviewSchema,
  queryCloudPackageProjectionSchema,
} from '@ky-azeroth/shared';
import { Command } from 'commander';

import { request } from '../client.js';
import { output, parseJsonWithSchema } from '../utils.js';

export function registerCloudBillSnapshotsExtras(cloudBillSnapshotsCmd: Command): void {
  const program = cloudBillSnapshotsCmd.parent;
  const getFormat = (): string => (program?.opts()['format'] as string | undefined) ?? 'json';

  // ── latest ───────────────────────────────────────────────────────
  cloudBillSnapshotsCmd
    .command('latest')
    .description('查询最新一条云账单快照（GET /cloud-bill-snapshots/latest）')
    .action(async () => {
      const result = await request<CloudBillSnapshotResponseOutput>(
        'GET',
        '/cloud-bill-snapshots/latest'
      );
      output(result, getFormat());
    });

  // ── overview ─────────────────────────────────────────────────────
  // 字段（来自 queryCloudCostOverviewSchema）：月份范围等。
  // 字段较多 + 命名易变，统一走 --json 让 server schema 兜底。
  cloudBillSnapshotsCmd
    .command('overview')
    .description('云成本概览（GET /cloud-bill-snapshots/overview，按月聚合）')
    .option('--json <path>', 'query JSON（与 queryCloudCostOverviewSchema 对齐，或 "-" 走 stdin）')
    .action(async (opts: { json?: string }) => {
      const params = opts.json
        ? parseJsonWithSchema(queryCloudCostOverviewSchema, opts.json, '--json')
        : ({} as Record<string, unknown>);
      const result = await request<CloudCostOverviewResponseOutput>(
        'GET',
        '/cloud-bill-snapshots/overview',
        undefined,
        params as Record<string, unknown>
      );
      output(result, getFormat());
    });

  // ── package-projection ───────────────────────────────────────────
  cloudBillSnapshotsCmd
    .command('package-projection')
    .description('资源包到期/续费预测（GET /cloud-bill-snapshots/package-projection）')
    .option(
      '--json <path>',
      'query JSON（与 queryCloudPackageProjectionSchema 对齐，或 "-" 走 stdin）'
    )
    .action(async (opts: { json?: string }) => {
      const params = opts.json
        ? parseJsonWithSchema(queryCloudPackageProjectionSchema, opts.json, '--json')
        : ({} as Record<string, unknown>);
      const result = await request<CloudPackageProjectionOutput[]>(
        'GET',
        '/cloud-bill-snapshots/package-projection',
        undefined,
        params as Record<string, unknown>
      );
      output(result, getFormat());
    });
}
