/**
 * azeroth invoices —— 发票红冲子命令（追挂模式）
 *
 * 设计说明：
 *   - invoices 的 list/get/create/update/delete/submit-approval 由自动发现
 *     CRUD 模板与 EntityConfig.supportsSubmitApproval 注册。
 *   - 红冲（red-void）字段仅 2 个（version + reason），扁平 --xxx 表达即可，
 *     无需 --json 模式。version 用于乐观锁，CLI 强制要求传入。
 *   - 后端路由：POST /invoices/:id/red-void，body 走 redVoidInvoiceSchema。
 *   - 仅支持全额冲红；部分冲红场景 = 全冲 + 重开（业务规则，CLI 不感知）。
 *   - 支持 --dry-run。
 */

import {
  batchApproveSchema,
  batchIdsSchema,
  batchTransferInvoiceSchema,
  batchUpdateInvoiceSchema,
  type InvoiceResponseOutput,
  redVoidInvoiceSchema,
} from '@ky-azeroth/shared';
import { Command } from 'commander';

import { request } from '../client.js';
import {
  encodeUuidPathId,
  fatal,
  output,
  parseStrictInt,
  printJson,
  validateWithSchema,
} from '../utils.js';
import { registerJsonBatchAction } from './batch-actions.js';

interface RedVoidOpts {
  version?: string;
  reason?: string;
  dryRun?: boolean;
  yes?: boolean;
}

export function registerInvoicesExtras(invoicesCmd: Command): void {
  const program = invoicesCmd.parent;
  const getFormat = (): string => (program?.opts()['format'] as string | undefined) ?? 'json';

  registerJsonBatchAction(invoicesCmd, {
    command: 'batch-transfer',
    description: '批量转交发票负责人（PATCH /invoices/batch-transfer）',
    method: 'PATCH',
    path: '/invoices/batch-transfer',
    schema: batchTransferInvoiceSchema,
  });
  registerJsonBatchAction(invoicesCmd, {
    command: 'batch-update',
    description: '批量编辑发票白名单字段（PATCH /invoices/batch-update）',
    method: 'PATCH',
    path: '/invoices/batch-update',
    schema: batchUpdateInvoiceSchema,
  });
  registerJsonBatchAction(invoicesCmd, {
    command: 'batch-approve',
    description: '批量审批发票（POST /invoices/batch-approve）',
    method: 'POST',
    path: '/invoices/batch-approve',
    schema: batchApproveSchema,
  });
  registerJsonBatchAction(invoicesCmd, {
    command: 'batch-delete',
    description: '批量软删除发票（DELETE /invoices/batch）',
    method: 'DELETE',
    path: '/invoices/batch',
    schema: batchIdsSchema,
  });

  // ── red-void ───────────────────────────────────────────────────────
  // 红冲为不可逆财务动作，强制 --yes 显式确认（dry-run 除外）。
  // body 走 redVoidInvoiceSchema 校验（version int ≥1，reason 1-500 字符）。
  invoicesCmd
    .command('red-void <id>')
    .description('发票全额红冲（POST /invoices/:id/red-void，不可逆）')
    .option('--version <n>', '乐观锁版本号（必填，正整数）')
    .option('--reason <text>', '冲红原因（必填，1-500 字）')
    .option('--dry-run', '只打印 POST 请求体，不实际发起')
    .option('--yes', '确认红冲（非 dry-run 时必填，承认不可逆）')
    .action(async (id: string, opts: RedVoidOpts) => {
      if (opts.version === undefined) {
        fatal('Missing --version', 'Expected positive integer');
      }
      if (opts.reason === undefined) {
        fatal('Missing --reason', 'Expected 1-500 chars');
      }
      const versionNum = parseStrictInt(opts.version, '--version');
      // body 整体走 shared schema 校验：version min(1) + reason min(1)/max(500)
      const body = validateWithSchema(
        redVoidInvoiceSchema,
        { version: versionNum, reason: opts.reason },
        'red-void body'
      );
      const path = `/invoices/${encodeUuidPathId(id, 'id')}/red-void`;
      if (opts.dryRun) {
        printJson({ method: 'POST', path, body });
        return;
      }
      if (!opts.yes) {
        fatal(
          'Missing --yes',
          'Red-void is irreversible. Pass --yes to confirm, or --dry-run to preview'
        );
      }
      const result = await request<InvoiceResponseOutput>(
        'POST',
        path,
        body as Record<string, unknown>
      );
      output(result, getFormat());
    });
}
