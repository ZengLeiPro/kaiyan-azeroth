/**
 * azeroth system-params —— 系统参数子命令组（顶级注册模式）
 *
 * 设计说明：
 *   - shared 命名错位：`querySystemConfigSchema` + `updateSystemParamSchema`
 *     +`systemParamResponseSchema`，没有 `createSystemParamSchema`（系统参数
 *     由迁移/seed 预置，业务面只能查/改，不允许 CLI 任意新增）。
 *     自动 entity discovery 在 Pass 1 找不到三件组、Pass 2 命名又对不上，
 *     直接静默 drop——所以走 finance.ts 同款"顶级 program.command"模式手挂。
 *   - 后端 endpoint（system-params.controller.ts）：
 *     - GET  /system-params                 list（按 module 分组返回）
 *     - GET  /system-params/:id             get by id
 *     - GET  /system-params/code/:code      get by stable code（运维高频）
 *     - PUT  /system-params/:id             update（含乐观锁 version）
 *   - body 由 shared `updateSystemParamSchema` 兜底校验，与 server 同源。
 *   - 写入支持 --dry-run；写入失败由 client.ts 统一映射结构化 fatal。
 */

import {
  type SystemParamGroupedListResponseOutput,
  type SystemParamResponse,
  updateSystemParamSchema,
} from '@ky-azeroth/shared';
import { Command } from 'commander';

import { request } from '../client.js';
import { encodeUuidPathId, fatal, output, parseJsonWithSchema, printJson } from '../utils.js';

export function registerSystemParamsCommands(program: Command): void {
  const sysParams = program
    .command('system-params')
    .description('系统参数（system-params controller，分组查/按 code 查/带乐观锁更新）');

  const getFormat = (): string => (program.opts()['format'] as string | undefined) ?? 'json';

  // ── list ──────────────────────────────────────────────────────────
  sysParams
    .command('list')
    .description('列出所有系统参数（GET /system-params，按 module 分组返回）')
    .option('--module <name>', '按 module 过滤（可选，对应 group_key）')
    .action(async (opts: { module?: string }) => {
      const params: Record<string, unknown> = {};
      if (opts.module) params['module'] = opts.module;
      const result = await request<SystemParamGroupedListResponseOutput>(
        'GET',
        '/system-params',
        undefined,
        params
      );
      output(result, getFormat());
    });

  // ── get by id ─────────────────────────────────────────────────────
  sysParams
    .command('get <id>')
    .description('按 id 查询单条系统参数（GET /system-params/:id）')
    .action(async (id: string) => {
      const result = await request<SystemParamResponse>(
        'GET',
        `/system-params/${encodeUuidPathId(id, 'id')}`
      );
      output(result, getFormat());
    });

  // ── get by code ───────────────────────────────────────────────────
  sysParams
    .command('get-by-code <code>')
    .description('按稳定 code 查询系统参数（GET /system-params/code/:code，运维高频）')
    .action(async (code: string) => {
      const result = await request<SystemParamResponse>(
        'GET',
        `/system-params/code/${encodeURIComponent(code)}`
      );
      output(result, getFormat());
    });

  // ── update ────────────────────────────────────────────────────────
  // body 走 --json：updateSystemParamSchema 含乐观锁 version 字段，强制要求。
  // 直接传 flag 易遗漏 version 字段导致 409，统一走 --json 更安全。
  sysParams
    .command('update <id>')
    .description('更新系统参数（PUT /system-params/:id，body 含乐观锁 version）')
    .option('--json <path>', 'body JSON 路径（含 version 乐观锁字段，或 "-" 走 stdin）')
    .option('--dry-run', '只打印请求体，不发请求')
    .action(async (id: string, opts: { json?: string; dryRun?: boolean }) => {
      if (!opts.json) {
        fatal(
          'Missing --json',
          'updateSystemParamSchema 要求 version 字段；建议先 `get <id>` 读 version 再编辑 body'
        );
      }
      const body = parseJsonWithSchema(updateSystemParamSchema, opts.json!, '--json');
      const path = `/system-params/${encodeUuidPathId(id, 'id')}`;
      if (opts.dryRun) {
        printJson({ method: 'PUT', path, body });
        return;
      }
      const result = await request<SystemParamResponse>(
        'PUT',
        path,
        body as unknown as Record<string, unknown>
      );
      output(result, getFormat());
    });
}
