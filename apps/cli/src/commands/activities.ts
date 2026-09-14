/**
 * azeroth activities —— 客户活动时间线（2026-06-16 投影派）。
 *
 * 端点：GET /activities?customerId=xxx（扁平路由约定）
 *
 * 设计目的：
 *  - 替代「客户 AI 见解 v2 cron」原来的 9 维 dump 路径，单一来源喂 Agent
 *  - 也供夜间闭环、销售带队视图、临时盯单查询直接调用
 *  - 默认 importance=milestone（给 Agent 用最干净）
 *
 * 不暴露 create/update/delete —— 活动是只读 union 视图，写入仍走原 service。
 *
 * 典型用法：
 *   azeroth activities list --customer-id=<id>
 *   azeroth activities list --customer-id=<id> --since=2026-05-01 --importance=milestone
 *   azeroth activities list --customer-id=<id> --category=order,payment --limit=20
 *   azeroth activities list --customer-id=<id> --format=ndjson  # 喂 Agent 必备
 */

import type { ActivityItem, ActivityListResponse } from '@ky-azeroth/shared';
import { Command, Option } from 'commander';

import { request } from '../client.js';
import {
  encodeUuidPathId,
  fatal,
  output,
  parseIsoInstant,
  parsePositiveInt,
  printJson,
} from '../utils.js';

interface ActivitiesListOpts {
  customerId?: string;
  since?: string;
  until?: string;
  importance?: string; // 单值或逗号分隔
  category?: string;
  limit?: string;
  cursor?: string;
  format?: 'json' | 'table' | 'ndjson';
}

export function registerActivitiesCommands(program: Command): void {
  const activities = program
    .command('activities')
    .description('客户活动时间线（GET /customers/:id/activities）');

  const getGlobalFormat = (): string => (program.opts()['format'] as string | undefined) ?? 'json';

  activities
    .command('list')
    .description('查询客户活动时间线（投影 keep + visit + operation_logs）')
    .requiredOption('--customer-id <id>', '客户 ID（必填）')
    .option('--since <iso>', '起始时间 ISO 8601（含）')
    .option('--until <iso>', '结束时间 ISO 8601（含）')
    .option('--importance <vals>', 'milestone / normal / trivial（单值或逗号分隔）')
    .option(
      '--category <vals>',
      'follow_up,visit,opportunity,order,payment,invoice,contact,customer'
    )
    .option('--limit <n>', '上限（默认 50，最大 500）')
    .option('--cursor <iso>', '上一页最后一条的 occurredAt，用于翻更早数据')
    .addOption(
      new Option('--format <fmt>', '输出格式（覆盖全局 --format）').choices([
        'json',
        'table',
        'ndjson',
      ])
    )
    .action(async (opts: ActivitiesListOpts) => {
      if (!opts.customerId) {
        fatal('缺少 --customer-id');
      }
      const validateCsv = (raw: string, label: string, allowed: readonly string[]): string => {
        const values = raw
          .split(',')
          .map((value) => value.trim())
          .filter(Boolean);
        if (values.length === 0 || values.some((value) => !allowed.includes(value))) {
          fatal(`Invalid ${label} "${raw}"`, `Allowed: ${allowed.join(' | ')}`);
        }
        return values.join(',');
      };
      const since = opts.since ? parseIsoInstant(opts.since, '--since') : undefined;
      const until = opts.until ? parseIsoInstant(opts.until, '--until') : undefined;
      if (since && until && since > until)
        fatal('Invalid activity time range', '--since must not be after --until');

      const params = new URLSearchParams();
      params.set('customerId', encodeUuidPathId(opts.customerId, 'customerId'));
      if (since) params.set('since', since);
      if (until) params.set('until', until);
      if (opts.importance) {
        params.set(
          'importance',
          validateCsv(opts.importance, '--importance', ['milestone', 'normal', 'trivial'])
        );
      }
      if (opts.category) {
        params.set(
          'category',
          validateCsv(opts.category, '--category', [
            'follow_up',
            'visit',
            'opportunity',
            'order',
            'payment',
            'invoice',
            'contact',
            'customer',
          ])
        );
      }
      if (opts.limit) {
        const limit = parsePositiveInt(opts.limit, '--limit');
        if (limit > 500) fatal('Invalid --limit', 'Expected 1..500');
        params.set('limit', String(limit));
      }
      if (opts.cursor) params.set('cursor', parseIsoInstant(opts.cursor, '--cursor'));

      const url = `/activities?${params.toString()}`;
      const result = (await request('GET', url)) as ActivityListResponse;

      const format = opts.format ?? getGlobalFormat();
      if (format === 'ndjson') {
        // Agent 友好：每行一个 ActivityItem，下游 jq -c 直接消费
        for (const item of result.items) {
          printJson(item, true);
        }
        return;
      }
      if (format === 'table') {
        const rows = result.items.map((item: ActivityItem) => ({
          time: item.occurredAt.replace('T', ' ').slice(0, 16),
          importance: item.importance,
          category: item.category,
          actor: item.actorName ?? '-',
          summary: item.summary,
        }));
        output(rows, 'table', { columns: ['time', 'importance', 'category', 'actor', 'summary'] });
        if (result.nextCursor) {
          console.log(`\n(还有更早数据；--cursor=${result.nextCursor})`);
        }
        return;
      }
      // 默认 json
      output(result, 'json');
    });
}
