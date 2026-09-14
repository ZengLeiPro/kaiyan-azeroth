/**
 * azeroth effort-records —— 批量创建/我的视图/统计子命令组（追挂模式）
 *
 * 设计说明：
 *   - effort-records 的 list/get/create/update/delete 由自动发现 CRUD 模板注册。
 *   - 本文件追挂 4 条非标 endpoint（2026-06-13 audit 补齐 my-timesheet/stats）：
 *     - POST /effort-records/batch              批量原子提交（最多 20 条/单次）
 *     - GET  /effort-records/my/timesheet       我的周/日工时（按日期范围）
 *     - GET  /effort-records/my/recent-projects 我的近期项目列表（无入参）
 *     - GET  /effort-records/stats              工时统计聚合（按维度 groupBy）
 *
 *   batch：工时补录高频场景，单事务批量插入任意失败整批回滚。
 *   my-timesheet / stats：日报+工时报表自动化的关键看板，原审计标 P1 medium。
 */

import {
  batchCreateEffortRecordSchema,
  effortStatsQuerySchema,
  type IBatchCreateEffortRecordResponse,
} from '@ky-azeroth/shared';
import { Command } from 'commander';

import { request } from '../client.js';
import { fatal, output, parseJsonWithSchema, printJson, validateWithSchema } from '../utils.js';

export function registerEffortRecordsExtras(effortRecordsCmd: Command): void {
  const program = effortRecordsCmd.parent;
  const getFormat = (): string => (program?.opts()['format'] as string | undefined) ?? 'json';

  // ── batch-create ──────────────────────────────────────────────────
  // POST /effort-records/batch，body = { items: CreateEffortRecordInput[] }（1-20 条）
  // 字段数大且嵌套（projectId/recordType/date/hours/description/...），统一走 --json。
  effortRecordsCmd
    .command('batch-create')
    .description('批量创建工时记录（POST /effort-records/batch，单次 1-20 条原子提交）')
    .option('--json <path>', 'body JSON：{ items: [...] }（或 "-" 表示从 stdin 读）')
    .option('--dry-run', '只打印请求体，不实际发起')
    .action(async (opts: { json?: string; dryRun?: boolean }) => {
      if (!opts.json) fatal('Missing --json');
      const body = parseJsonWithSchema(batchCreateEffortRecordSchema, opts.json, '--json');

      const path = '/effort-records/batch';
      if (opts.dryRun) {
        printJson({ method: 'POST', path, body });
        return;
      }
      const result = await request<IBatchCreateEffortRecordResponse>(
        'POST',
        path,
        body as unknown as Record<string, unknown>
      );
      output(result, getFormat());
    });

  // ── my-timesheet ──────────────────────────────────────────────────
  // GET /effort-records/my/timesheet?startDate&endDate&recordType?
  // server 强制要求 startDate/endDate（ISO yyyy-mm-dd）。
  effortRecordsCmd
    .command('my-timesheet')
    .description('我的工时表（GET /effort-records/my/timesheet，按日期范围）')
    .option('--start-date <iso>', '起始日期 YYYY-MM-DD（必填）')
    .option('--end-date <iso>', '结束日期 YYYY-MM-DD（必填）')
    .option('--record-type <t>', '工时类型过滤（可选，参考 RECORD_TYPE 枚举）')
    .action(async (opts: { startDate?: string; endDate?: string; recordType?: string }) => {
      if (!opts.startDate) fatal('Missing --start-date', 'Expected YYYY-MM-DD');
      if (!opts.endDate) fatal('Missing --end-date', 'Expected YYYY-MM-DD');
      const params: Record<string, unknown> = {
        startDate: opts.startDate,
        endDate: opts.endDate,
      };
      if (opts.recordType) params['recordType'] = opts.recordType;
      const result = await request('GET', '/effort-records/my/timesheet', undefined, params);
      output(result, getFormat());
    });

  // ── my-recent-projects ────────────────────────────────────────────
  effortRecordsCmd
    .command('my-recent-projects')
    .description('我近期填过工时的项目（GET /effort-records/my/recent-projects）')
    .action(async () => {
      const result = await request('GET', '/effort-records/my/recent-projects');
      output(result, getFormat());
    });

  // ── stats ────────────────────────────────────────────────────────
  // GET /effort-records/stats?groupBy=person|customer|workType|completion|project + 时间范围 + 过滤
  // schema 有 superRefine（groupBy=project 之外 startDate/endDate 必填），CLI 直接走 --json
  // 避免重复实现联动校验。
  effortRecordsCmd
    .command('stats')
    .description('工时统计聚合（GET /effort-records/stats，按 groupBy 维度聚合）')
    .option(
      '--json <path>',
      'query JSON（与 effortStatsQuerySchema 对齐，含 groupBy + 时间范围；或 "-" 走 stdin）'
    )
    .option(
      '--group-by <dim>',
      '聚合维度：person|customer|workType|completion|project（与 --json 二选一）'
    )
    .option('--start-date <iso>', '起始日期 YYYY-MM-DD')
    .option('--end-date <iso>', '结束日期 YYYY-MM-DD')
    .option('--project-id <id>', '项目过滤')
    .option('--customer-id <id>', '客户过滤')
    .option('--owner-id <id>', '负责人过滤')
    .action(
      async (opts: {
        json?: string;
        groupBy?: string;
        startDate?: string;
        endDate?: string;
        projectId?: string;
        customerId?: string;
        ownerId?: string;
      }) => {
        let params: Record<string, unknown>;
        if (opts.json) {
          params = parseJsonWithSchema(effortStatsQuerySchema, opts.json, '--json') as Record<
            string,
            unknown
          >;
        } else {
          if (!opts.groupBy) {
            fatal('Missing --group-by or --json', 'Expected groupBy 维度');
          }
          const raw: Record<string, unknown> = { groupBy: opts.groupBy };
          if (opts.startDate) raw['startDate'] = opts.startDate;
          if (opts.endDate) raw['endDate'] = opts.endDate;
          if (opts.projectId) raw['projectId'] = opts.projectId;
          if (opts.customerId) raw['customerId'] = opts.customerId;
          if (opts.ownerId) raw['ownerId'] = opts.ownerId;
          params = validateWithSchema(effortStatsQuerySchema, raw, 'stats query') as Record<
            string,
            unknown
          >;
        }
        const result = await request('GET', '/effort-records/stats', undefined, params);
        output(result, getFormat());
      }
    );
}
