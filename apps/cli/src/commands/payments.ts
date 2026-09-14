/**
 * azeroth payments —— 退款创建 / 退款审批提交子命令组（追挂模式）
 *
 * 设计说明：
 *   - payments 的 list/get/create/update/delete/submit-approval 由自动发现
 *     CRUD 模板与 EntityConfig.supportsSubmitApproval 注册。
 *   - 本文件追挂 OUT 方向（退款）专用入口：
 *     - POST /payments/refund                       body = CreatePaymentRefundInput（11 字段）
 *     - POST /payments/:id/submit-refund-approval   仅 path 参数
 *   - 字段数大（含 saleOrderId/paymentAmount/paymentType/businessDate/
 *     bankName/chargerId/refundType/relatedPaymentId/relatedInvoiceId/...）
 *     且含枚举校验，统一走 `--json <file>`。
 *   - 写入命令支持 --dry-run。
 */

import {
  batchApproveSchema,
  batchIdsSchema,
  batchTransferPaymentSchema,
  batchUpdatePaymentSchema,
  createPaymentRefundSchema,
  mergeInvoiceSchema,
  type PaymentResponseOutput,
  voidApprovalRequestSchema,
} from '@ky-azeroth/shared';
import { Command } from 'commander';

import { request } from '../client.js';
import { encodeUuidPathId, fatal, output, parseJsonWithSchema, printJson } from '../utils.js';
import { registerJsonBatchAction } from './batch-actions.js';

/** server BusinessApprovalService 返回审批实例 + body，CLI 端不强约束，宽松类型即可 */
interface ApprovalSubmissionResult {
  id: string;
  status?: string;
  [k: string]: unknown;
}

export function registerPaymentsExtras(paymentsCmd: Command): void {
  const program = paymentsCmd.parent;
  const getFormat = (): string => (program?.opts()['format'] as string | undefined) ?? 'json';

  registerJsonBatchAction(paymentsCmd, {
    command: 'batch-transfer',
    description: '批量转交回款负责人（PATCH /payments/batch-transfer）',
    method: 'PATCH',
    path: '/payments/batch-transfer',
    schema: batchTransferPaymentSchema,
  });
  registerJsonBatchAction(paymentsCmd, {
    command: 'batch-update',
    description: '批量编辑回款白名单字段（PATCH /payments/batch-update）',
    method: 'PATCH',
    path: '/payments/batch-update',
    schema: batchUpdatePaymentSchema,
  });
  registerJsonBatchAction(paymentsCmd, {
    command: 'batch-approve',
    description: '批量审批回款（POST /payments/batch-approve）',
    method: 'POST',
    path: '/payments/batch-approve',
    schema: batchApproveSchema,
  });
  registerJsonBatchAction(paymentsCmd, {
    command: 'merge-invoice',
    description: '合并回款生成发票（POST /payments/merge-invoice）',
    method: 'POST',
    path: '/payments/merge-invoice',
    schema: mergeInvoiceSchema,
  });
  registerJsonBatchAction(paymentsCmd, {
    command: 'batch-delete',
    description: '批量软删除回款（DELETE /payments/batch）',
    method: 'DELETE',
    path: '/payments/batch',
    schema: batchIdsSchema,
  });

  // ── create-refund ──────────────────────────────────────────────────
  paymentsCmd
    .command('create-refund')
    .description('创建退款（OUT 方向，POST /payments/refund）')
    .option(
      '--json <path>',
      'body JSON：含 saleOrderId/paymentAmount/refundType/relatedPaymentId 等 11 字段'
    )
    .option('--dry-run', '只打印 POST 请求体，不实际发起')
    .action(async (opts: { json?: string; dryRun?: boolean }) => {
      if (!opts.json) fatal('Missing --json');
      const body = parseJsonWithSchema(createPaymentRefundSchema, opts.json, '--json');
      const path = '/payments/refund';
      if (opts.dryRun) {
        printJson({ method: 'POST', path, body });
        return;
      }
      const result = await request<PaymentResponseOutput>(
        'POST',
        path,
        body as Record<string, unknown>
      );
      output(result, getFormat());
    });

  // ── submit-refund-approval ─────────────────────────────────────────
  // 退款审批专用 thin wrapper：与 submit-approval 区别在 eventType。
  // 后端 BusinessApprovalService 按 PAYMENT_REFUND eventType 派发，CLI 仅传 id。
  paymentsCmd
    .command('submit-refund-approval <id>')
    .description('提交退款审批（POST /payments/:id/submit-refund-approval）')
    .option('--dry-run', '只打印请求路径，不实际发起')
    .action(async (id: string, opts: { dryRun?: boolean }) => {
      const path = `/payments/${encodeUuidPathId(id, 'id')}/submit-refund-approval`;
      if (opts.dryRun) {
        printJson({ method: 'POST', path, body: {} });
        return;
      }
      const result = await request<ApprovalSubmissionResult>('POST', path);
      output(result, getFormat());
    });

  paymentsCmd
    .command('void-request <id>')
    .description('提交已审批回款或退款作废申请（POST /payments/:id/void-request）')
    .requiredOption('--json <path>', 'body JSON：{ reason, version }')
    .option('--dry-run', '只打印 POST 请求体，不实际发起')
    .action(async (id: string, opts: { json: string; dryRun?: boolean }) => {
      const body = parseJsonWithSchema(voidApprovalRequestSchema, opts.json, '--json');
      const path = `/payments/${encodeUuidPathId(id, 'id')}/void-request`;
      if (opts.dryRun) {
        printJson({ method: 'POST', path, body });
        return;
      }
      const result = await request<ApprovalSubmissionResult>(
        'POST',
        path,
        body as Record<string, unknown>
      );
      output(result, getFormat());
    });
}
