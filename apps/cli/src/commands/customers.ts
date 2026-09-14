/**
 * azeroth customers —— 客户回收站/查重/批量操作子命令组（追挂模式）
 *
 * 设计说明：
 *   - customers 的 list/get/create/update/delete/restore/claim 由自动发现
 *     的 CRUD 模板与 EntityConfig.supportsRestore/Claim 注册，本文件只追挂
 *     非标准 CRUD 的 8 个能力。
 *   - 批量类命令 body 均含 ids 数组 + 业务字段（如 patch / chargerId /
 *     collaboratorIds），字段数与嵌套度大于扁平 --xxx flag 适合表达的尺寸，
 *     故统一走 `--json <file>`（支持 `-` 从 stdin）。
 *   - duplicate-check 同样走 `--json`，字段数 6 + superRefine "至少填一个"
 *     校验由 server 端 schema 兜底；CLI 仅做 fail-fast 形态校验。
 *   - 后端路由（customers.controller.ts）：
 *     - GET    /customers/trash                       分页列表
 *     - POST   /customers/duplicate-check             body = CheckCustomerDuplicateInput
 *     - PATCH  /customers/batch-transfer              body = BatchTransferCustomerInput
 *     - PATCH  /customers/batch-update                body = BatchUpdateCustomerInput
 *     - PATCH  /customers/batch-add-collaborators     body = BatchCollaboratorsCustomerInput
 *     - PATCH  /customers/batch-remove-collaborators  body = BatchCollaboratorsCustomerInput
 *     - DELETE /customers/batch                       body = BatchRemoveCustomerInput
 *     - DELETE /customers/:id/permanent               仅 ADMIN
 *     - PATCH  /customers/:id/lead-stage-correction   仅 ADMIN
 *   - 所有写入命令支持 --dry-run；trash 是只读列表，沿用分页 flag。
 */

import {
  batchCollaboratorsCustomerSchema,
  batchRemoveCustomerSchema,
  batchTransferCustomerSchema,
  batchUpdateCustomerSchema,
  checkCustomerDuplicateSchema,
  type CustomerDuplicateCheckResponseOutput,
  updateLeadProgressSchema,
} from '@ky-azeroth/shared';
import { Command } from 'commander';
import type { z } from 'zod';

import { request } from '../client.js';
import {
  encodeUuidPathId,
  fatal,
  output,
  parseJsonWithSchema,
  parseStrictInt,
  printJson,
} from '../utils.js';

interface TrashOpts {
  page?: string;
  pageSize?: string;
  keyword?: string;
}

/** 批量操作的标准服务端响应（customers.controller 全部返回此结构） */
interface BatchResult {
  success: number;
  skipped: string[];
}

function customerPath(id: string): string {
  return `/customers/${encodeUuidPathId(id, 'customer id')}`;
}

function parseCustomerVersion(value: string): number {
  const version = parseStrictInt(value, '--version');
  if (version < 1) {
    fatal('Invalid --version', 'Expected a positive integer (>= 1)');
  }
  return version;
}

/**
 * 通用 batch 子命令 action：
 *   1. 读 JSON 文件
 *   2. 用 shared zod schema 校验（与服务端语义一致，dry-run 不再误报通过）
 *   3. 校验通过则发请求 / dry-run 打印
 */
async function runBodyJsonAction<S extends z.ZodTypeAny>(
  method: 'POST' | 'PATCH' | 'DELETE',
  path: string,
  schema: S,
  jsonPath: string | undefined,
  dryRun: boolean | undefined,
  yes: boolean | undefined,
  format: string
): Promise<void> {
  if (!jsonPath) {
    fatal('Missing --json', 'Pass a JSON file path (or "-" for stdin)');
  }
  const body = parseJsonWithSchema(schema, jsonPath, '--json');
  if (dryRun) {
    printJson({ method, path, body });
    return;
  }
  if (!yes) {
    fatal('Missing --yes', {
      operation: path,
      hint: 'All customer batch mutations require --yes; use --dry-run to preview safely',
    });
  }
  const result = await request<BatchResult>(method, path, body as Record<string, unknown>);
  output(result, format);
}

export function registerCustomersExtras(customersCmd: Command): void {
  const program = customersCmd.parent;
  const getFormat = (): string => (program?.opts()['format'] as string | undefined) ?? 'json';

  // ── trash ──────────────────────────────────────────────────────────
  // 只读分页列表。与自动注册的 `customers list` 同形，但底层走 /trash 路由。
  customersCmd
    .command('trash')
    .description('查询回收站客户列表（GET /customers/trash）')
    .option('--page <n>', '页码（默认 1）')
    .option('--page-size <n>', '每页大小（默认 100）')
    .option('--keyword <text>', '关键词')
    .action(async (opts: TrashOpts) => {
      const page = opts.page === undefined ? 1 : parseStrictInt(opts.page, '--page');
      const pageSize =
        opts.pageSize === undefined ? 100 : parseStrictInt(opts.pageSize, '--page-size');
      if (page < 1 || pageSize < 1) {
        fatal('Invalid pagination', '--page and --page-size must be positive integers (>= 1)');
      }
      const params: Record<string, unknown> = { page, pageSize };
      if (opts.keyword) params['keyword'] = opts.keyword;
      const result = await request<{
        items: Record<string, unknown>[];
        total: number;
      }>('GET', '/customers/trash', undefined, params);
      output(result, getFormat());
    });

  // ── duplicate-check ────────────────────────────────────────────────
  customersCmd
    .command('duplicate-check')
    .description('客户查重（POST /customers/duplicate-check）')
    .option(
      '--json <path>',
      '查重条件 JSON 文件（至少含一个：customerName/shortName/phone/uncId/organizationId）'
    )
    .option('--dry-run', '只打印 POST 请求体，不实际发起')
    .action(async (opts: { json?: string; dryRun?: boolean }) => {
      if (!opts.json) fatal('Missing --json');
      const body = parseJsonWithSchema(checkCustomerDuplicateSchema, opts.json, '--json');
      const path = '/customers/duplicate-check';
      if (opts.dryRun) {
        printJson({ method: 'POST', path, body });
        return;
      }
      const result = await request<CustomerDuplicateCheckResponseOutput>(
        'POST',
        path,
        body as Record<string, unknown>
      );
      output(result, getFormat());
    });

  // ── batch-transfer ─────────────────────────────────────────────────
  customersCmd
    .command('batch-transfer')
    .description('批量转交客户负责人（PATCH /customers/batch-transfer）')
    .option('--json <path>', 'body JSON：{ ids: [...], versions: { [id]: version }, chargerId }')
    .option('--yes', '确认执行批量变更（非 dry-run 时必填）')
    .option('--dry-run', '只打印 PATCH 请求体，不实际发起')
    .action(async (opts: { json?: string; dryRun?: boolean; yes?: boolean }) => {
      await runBodyJsonAction(
        'PATCH',
        '/customers/batch-transfer',
        batchTransferCustomerSchema,
        opts.json,
        opts.dryRun,
        opts.yes,
        getFormat()
      );
    });

  // ── batch-update ───────────────────────────────────────────────────
  customersCmd
    .command('batch-update')
    .description('批量编辑客户白名单字段（PATCH /customers/batch-update）')
    .option(
      '--json <path>',
      'body JSON：{ ids: [...], versions: { [id]: version }, patch: { customerLevel?/industry?/customerSource?/customerRelationship? } }'
    )
    .option('--yes', '确认执行批量变更（非 dry-run 时必填）')
    .option('--dry-run', '只打印 PATCH 请求体，不实际发起')
    .action(async (opts: { json?: string; dryRun?: boolean; yes?: boolean }) => {
      await runBodyJsonAction(
        'PATCH',
        '/customers/batch-update',
        batchUpdateCustomerSchema,
        opts.json,
        opts.dryRun,
        opts.yes,
        getFormat()
      );
    });

  // ── batch-add-collaborators ────────────────────────────────────────
  customersCmd
    .command('batch-add-collaborators')
    .description('批量添加协作人（PATCH /customers/batch-add-collaborators）')
    .option(
      '--json <path>',
      'body JSON：{ ids: [...], versions: { [id]: version }, collaboratorIds: [...] }'
    )
    .option('--yes', '确认执行批量变更（非 dry-run 时必填）')
    .option('--dry-run', '只打印 PATCH 请求体，不实际发起')
    .action(async (opts: { json?: string; dryRun?: boolean; yes?: boolean }) => {
      await runBodyJsonAction(
        'PATCH',
        '/customers/batch-add-collaborators',
        batchCollaboratorsCustomerSchema,
        opts.json,
        opts.dryRun,
        opts.yes,
        getFormat()
      );
    });

  // ── batch-remove-collaborators ─────────────────────────────────────
  customersCmd
    .command('batch-remove-collaborators')
    .description('批量移除协作人（PATCH /customers/batch-remove-collaborators）')
    .option(
      '--json <path>',
      'body JSON：{ ids: [...], versions: { [id]: version }, collaboratorIds: [...] }'
    )
    .option('--yes', '确认执行批量变更（非 dry-run 时必填）')
    .option('--dry-run', '只打印 PATCH 请求体，不实际发起')
    .action(async (opts: { json?: string; dryRun?: boolean; yes?: boolean }) => {
      await runBodyJsonAction(
        'PATCH',
        '/customers/batch-remove-collaborators',
        batchCollaboratorsCustomerSchema,
        opts.json,
        opts.dryRun,
        opts.yes,
        getFormat()
      );
    });

  // ── batch-delete ───────────────────────────────────────────────────
  // 即使是可 restore 的软删除，也与其它 customer batch mutation 一致强制 --yes。
  customersCmd
    .command('batch-delete')
    .description('批量软删除客户（DELETE /customers/batch）')
    .option('--json <path>', 'body JSON：{ ids: [...], versions: { [id]: version } }')
    .option('--yes', '确认执行批量变更（非 dry-run 时必填）')
    .option('--dry-run', '只打印 DELETE 请求体，不实际发起')
    .action(async (opts: { json?: string; dryRun?: boolean; yes?: boolean }) => {
      await runBodyJsonAction(
        'DELETE',
        '/customers/batch',
        batchRemoveCustomerSchema,
        opts.json,
        opts.dryRun,
        opts.yes,
        getFormat()
      );
    });

  // ── permanent-delete ───────────────────────────────────────────────
  // 仅 ADMIN 可调，非 admin 调用返回 403。CLI 不做角色预检，让 server 拒绝。
  // 物理删除不可恢复，强制要求 --yes 显式确认（dry-run 除外）。
  customersCmd
    .command('permanent-delete <id>')
    .description('永久删除客户（DELETE /customers/:id/permanent，仅 ADMIN，不可恢复）')
    .requiredOption('--version <n>', '回收站中的客户当前 version（必填，调用方 CAS）')
    .option('--dry-run', '只打印请求路径，不实际发起')
    .option('--yes', '确认永久删除（非 dry-run 时必填，承认不可恢复）')
    .action(async (id: string, opts: { version: string; dryRun?: boolean; yes?: boolean }) => {
      const path = `${customerPath(id)}/permanent`;
      const body = { version: parseCustomerVersion(opts.version) };
      if (opts.dryRun) {
        printJson({ method: 'DELETE', path, body });
        return;
      }
      if (!opts.yes) {
        fatal(
          'Missing --yes',
          'Permanent delete is irreversible. Pass --yes to confirm, or --dry-run to preview'
        );
      }
      const result = await request<{ success: boolean }>('DELETE', path, body);
      output(result, getFormat());
    });

  // ── correct-lead-stage ─────────────────────────────────────────────
  customersCmd
    .command('correct-lead-stage <id>')
    .description(
      'ADMIN 修正历史线索阶段与原始打标时间（PATCH /customers/:id/lead-stage-correction）'
    )
    .requiredOption('--stage <MQL|SQL>', '目标阶段，MQL 或 SQL')
    .requiredOption('--qualified-at <iso>', '原始打标时间（ISO 8601，必须带时区）')
    .requiredOption('--version <n>', '客户当前 version（从 customers get 获取）')
    .requiredOption('--reason <text>', '修正原因（1-500 字）')
    .option('--dry-run', '预览请求路径与请求体，不实际发起；无需 --yes')
    .option('--yes', '确认执行修正（请先用 --dry-run 预览；非 dry-run 时必填）')
    .action(
      async (
        id: string,
        opts: {
          stage: string;
          qualifiedAt: string;
          version: string;
          reason: string;
          dryRun?: boolean;
          yes?: boolean;
        }
      ) => {
        const basePath = customerPath(id);
        const stage = opts.stage.trim();
        if (stage !== 'MQL' && stage !== 'SQL') {
          fatal('Invalid --stage', '--stage must be MQL or SQL');
        }
        const body = {
          leadStage: stage,
          leadStageQualifiedAt: opts.qualifiedAt,
          reason: opts.reason,
          version: parseCustomerVersion(opts.version),
        };
        const path = `${basePath}/lead-stage-correction`;
        if (opts.dryRun) {
          printJson({ method: 'PATCH', path, body });
          return;
        }
        if (!opts.yes) {
          fatal('Missing --yes', {
            operation: 'customers correct-lead-stage',
            hint: 'Use --dry-run to preview, then pass --yes to execute the correction',
          });
        }
        const result = await request<Record<string, unknown>>('PATCH', path, body);
        output(result, getFormat());
      }
    );

  // ── set-lead-stage（审批入口兼容别名）──────────────────────────────
  // 普通 PUT 已严格禁止 leadStage；旧命令名保留，但与所有角色统一走变更审批。
  customersCmd
    .command('set-lead-stage <id>')
    .description('提交客户线索阶段 MQL/SQL 变更审批（兼容旧命令名）')
    .requiredOption('--stage <MQL|SQL>', '目标阶段，MQL 或 SQL')
    .requiredOption('--version <n>', '客户当前 version（乐观锁，从 customers get 获取）')
    .option('--qualified-by <employeeId>', '合格判定人 employeeId（默认 = 提单人）')
    .option('--reason <text>', '变更备注（≤500 字符）')
    .option('--dry-run', '只打印请求路径，不实际发起')
    .action(
      async (
        id: string,
        opts: {
          stage: string;
          version: string;
          qualifiedBy?: string;
          reason?: string;
          dryRun?: boolean;
        }
      ) => {
        const basePath = customerPath(id);
        const stage = opts.stage.trim();
        if (stage !== 'MQL' && stage !== 'SQL') {
          fatal('Invalid --stage', '--stage must be MQL or SQL');
        }
        const body: Record<string, unknown> = {
          leadStage: stage,
          version: parseCustomerVersion(opts.version),
        };
        if (opts.qualifiedBy) body.leadStageQualifiedById = opts.qualifiedBy;
        if (opts.reason) body.reason = opts.reason;
        const path = `${basePath}/lead-stage-change-request`;
        if (opts.dryRun) {
          printJson({ method: 'POST', path, body });
          return;
        }
        const result = await request<Record<string, unknown>>('POST', path, body);
        output(result, getFormat());
      }
    );

  // ── submit-lead-stage-change ───────────────────────────────────────
  // 所有角色发起 MQL/SQL 变更审批（POST /customers/:id/lead-stage-change-request）。
  // 必填 --version（乐观锁）：先 `azeroth customers get <id>` 拿到当前 version 再传。
  customersCmd
    .command('submit-lead-stage-change <id>')
    .description('电销提交线索阶段变更审批（POST /customers/:id/lead-stage-change-request）')
    .requiredOption('--stage <MQL|SQL>', '目标阶段，MQL 或 SQL（当前阶段不支持取消）')
    .requiredOption('--version <n>', '客户当前 version（乐观锁，从 customers get 拿）')
    .option('--qualified-by <employeeId>', '合格判定人 employeeId（默认 = 提单人）')
    .option('--reason <text>', '变更备注（≤500 字符）')
    .option('--dry-run', '只打印请求路径，不实际发起')
    .action(
      async (
        id: string,
        opts: {
          stage: string;
          version: string;
          qualifiedBy?: string;
          reason?: string;
          dryRun?: boolean;
        }
      ) => {
        const basePath = customerPath(id);
        const stage = opts.stage.trim();
        if (stage !== 'MQL' && stage !== 'SQL') {
          fatal('Invalid --stage', '--stage must be MQL or SQL');
        }
        const body: Record<string, unknown> = {
          leadStage: stage,
          version: parseCustomerVersion(opts.version),
        };
        if (opts.qualifiedBy) body.leadStageQualifiedById = opts.qualifiedBy;
        if (opts.reason) body.reason = opts.reason;
        const path = `${basePath}/lead-stage-change-request`;
        if (opts.dryRun) {
          printJson({ method: 'POST', path, body });
          return;
        }
        const result = await request<Record<string, unknown>>('POST', path, body);
        output(result, getFormat());
      }
    );

  // ── update-lead-progress ──────────────────────────────────────────
  customersCmd
    .command('update-lead-progress <id>')
    .description('更新 Leads 推进状态（PATCH /customers/:id/lead-progress）')
    .requiredOption('--json <path>', 'body JSON：{ status, appointmentAt?, reason?, version }')
    .option('--dry-run', '只打印 PATCH 请求体，不实际发起')
    .action(async (id: string, opts: { json: string; dryRun?: boolean }) => {
      const path = `${customerPath(id)}/lead-progress`;
      const body = parseJsonWithSchema(updateLeadProgressSchema, opts.json, '--json');
      if (opts.dryRun) {
        printJson({ method: 'PATCH', path, body });
        return;
      }
      const result = await request<Record<string, unknown>>(
        'PATCH',
        path,
        body as Record<string, unknown>
      );
      output(result, getFormat());
    });
}
