/**
 * azeroth project-tickets —— 状态机/转派/看板子命令组（追挂模式）
 *
 * 设计说明：
 *   - project-tickets 的 list/get/create/update/delete 由自动 CRUD 注册。
 *   - 本文件追挂 3 条非标 endpoint：
 *     - PATCH /project-tickets/:id/status     状态流转（含 toStatus + 各状态附文 + version）
 *     - PATCH /project-tickets/:id/assignee   改派接单人（assigneeId + version）
 *     - GET   /project-tickets/stats          看板统计（无入参，按 current user 隔离）
 *   - body 字段由 shared transitionProjectTicketSchema / reassignProjectTicketSchema
 *     双源同步校验。
 *   - 状态机字段多（toStatus / completionNote / closeNote / cancelReason / version），
 *     transition 直接走 `--json`；assignee 字段少（assigneeId + version），扁平 flag。
 */

import {
  type ProjectTicketResponseOutput,
  type ProjectTicketStatsResponseOutput,
  reassignProjectTicketSchema,
  transitionProjectTicketSchema,
} from '@ky-azeroth/shared';
import { Command } from 'commander';

import { request } from '../client.js';
import {
  encodeUuidPathId,
  fatal,
  output,
  parseJsonWithSchema,
  parseStrictInt,
  printJson,
  validateWithSchema,
} from '../utils.js';

export function registerProjectTicketsExtras(projectTicketsCmd: Command): void {
  const program = projectTicketsCmd.parent;
  const getFormat = (): string => (program?.opts()['format'] as string | undefined) ?? 'json';

  // ── transition (状态流转) ─────────────────────────────────────────
  // toStatus + 各状态附文 + version；字段较多 + 联动校验由 schema superRefine 兜底，
  // 统一走 --json，避免 CLI 重复实现"状态对应必填附文"的联动逻辑。
  projectTicketsCmd
    .command('transition <id>')
    .description('工单状态流转（PATCH /project-tickets/:id/status，含 version 乐观锁）')
    .option(
      '--json <path>',
      'body JSON 路径（含 toStatus / completionNote? / closeNote? / cancelReason? / version；或 "-" 走 stdin）'
    )
    .option('--dry-run', '只打印 PATCH 请求体，不实际发起')
    .action(async (id: string, opts: { json?: string; dryRun?: boolean }) => {
      if (!opts.json) {
        fatal(
          'Missing --json',
          'transitionProjectTicketSchema 含 toStatus + 状态附文 + version 多字段，且有联动校验；统一走 --json'
        );
      }
      const body = parseJsonWithSchema(transitionProjectTicketSchema, opts.json!, '--json');
      const path = `/project-tickets/${encodeUuidPathId(id, 'id')}/status`;
      if (opts.dryRun) {
        printJson({ method: 'PATCH', path, body });
        return;
      }
      const result = await request<ProjectTicketResponseOutput>(
        'PATCH',
        path,
        body as unknown as Record<string, unknown>
      );
      output(result, getFormat());
    });

  // ── reassign (改派接单人) ─────────────────────────────────────────
  projectTicketsCmd
    .command('reassign <id>')
    .description('改派工单接单人（PATCH /project-tickets/:id/assignee）')
    .option('--assignee-id <employeeId>', '新接单人 employeeId（必填）')
    .option('--version <n>', '当前工单 version（必填，乐观锁）')
    .option('--dry-run', '只打印 PATCH 请求体，不实际发起')
    .action(
      async (id: string, opts: { assigneeId?: string; version?: string; dryRun?: boolean }) => {
        if (!opts.assigneeId) fatal('Missing --assignee-id');
        if (!opts.version)
          fatal('Missing --version', '乐观锁字段，先 `project-tickets get <id>` 读取');
        const raw: Record<string, unknown> = {
          assigneeId: opts.assigneeId,
          version: parseStrictInt(opts.version, '--version'),
        };
        const body = validateWithSchema(reassignProjectTicketSchema, raw, 'reassign body');
        const path = `/project-tickets/${encodeUuidPathId(id, 'id')}/assignee`;
        if (opts.dryRun) {
          printJson({ method: 'PATCH', path, body });
          return;
        }
        const result = await request<ProjectTicketResponseOutput>(
          'PATCH',
          path,
          body as Record<string, unknown>
        );
        output(result, getFormat());
      }
    );

  // ── stats (个人看板) ──────────────────────────────────────────────
  // 无入参，server 按 current user 隔离返回（我的：待办/进行/已完成 等计数）。
  projectTicketsCmd
    .command('stats')
    .description('我的工单看板统计（GET /project-tickets/stats，按当前用户隔离）')
    .action(async () => {
      const result = await request<ProjectTicketStatsResponseOutput>(
        'GET',
        '/project-tickets/stats'
      );
      output(result, getFormat());
    });
}
