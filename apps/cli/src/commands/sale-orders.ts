import {
  batchApproveSchema,
  batchIdsSchema,
  batchTransferSaleOrderSchema,
  batchUpdateSaleOrderSchema,
  voidApprovalRequestSchema,
} from '@ky-azeroth/shared';
import { Command } from 'commander';

import { request } from '../client.js';
import { encodeUuidPathId, output, parseJsonWithSchema, printJson } from '../utils.js';
import { registerJsonBatchAction } from './batch-actions.js';

export function registerSaleOrdersExtras(saleOrdersCmd: Command): void {
  const program = saleOrdersCmd.parent;
  const getFormat = (): string => (program?.opts()['format'] as string | undefined) ?? 'json';

  registerJsonBatchAction(saleOrdersCmd, {
    command: 'batch-transfer',
    description: '批量转交销售订单负责人（PATCH /sale-orders/batch-transfer）',
    method: 'PATCH',
    path: '/sale-orders/batch-transfer',
    schema: batchTransferSaleOrderSchema,
  });
  registerJsonBatchAction(saleOrdersCmd, {
    command: 'batch-update',
    description: '批量编辑销售订单白名单字段（PATCH /sale-orders/batch-update）',
    method: 'PATCH',
    path: '/sale-orders/batch-update',
    schema: batchUpdateSaleOrderSchema,
  });
  registerJsonBatchAction(saleOrdersCmd, {
    command: 'batch-approve',
    description: '批量审批销售订单（POST /sale-orders/batch-approve）',
    method: 'POST',
    path: '/sale-orders/batch-approve',
    schema: batchApproveSchema,
  });
  registerJsonBatchAction(saleOrdersCmd, {
    command: 'batch-delete',
    description: '批量软删除销售订单（DELETE /sale-orders/batch）',
    method: 'DELETE',
    path: '/sale-orders/batch',
    schema: batchIdsSchema,
  });

  saleOrdersCmd
    .command('void-preview <id>')
    .description('预览订单作废影响范围（GET /sale-orders/:id/void-preview，只读）')
    .action(async (id: string) => {
      const path = `/sale-orders/${encodeUuidPathId(id, 'id')}/void-preview`;
      const result = await request<Record<string, unknown>>('GET', path);
      output(result, getFormat());
    });

  saleOrdersCmd
    .command('void-request <id>')
    .description('提交已审批合同订单作废申请（POST /sale-orders/:id/void-request）')
    .requiredOption('--json <path>', 'body JSON：{ reason, version }')
    .option('--dry-run', '只打印 POST 请求体，不实际发起')
    .action(async (id: string, opts: { json: string; dryRun?: boolean }) => {
      const body = parseJsonWithSchema(voidApprovalRequestSchema, opts.json, '--json');
      const path = `/sale-orders/${encodeUuidPathId(id, 'id')}/void-request`;
      if (opts.dryRun) {
        printJson({ method: 'POST', path, body });
        return;
      }
      const result = await request<Record<string, unknown>>(
        'POST',
        path,
        body as Record<string, unknown>
      );
      output(result, getFormat());
    });
}
