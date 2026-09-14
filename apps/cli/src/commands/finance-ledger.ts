import {
  batchUpdateSubjectSchema,
  linkPaymentSchema,
  unlinkPaymentSchema,
} from '@ky-azeroth/shared';
import { Command } from 'commander';

import { request } from '../client.js';
import { encodeUuidPathId, output, parseJsonWithSchema, printJson } from '../utils.js';
import { registerJsonBatchAction } from './batch-actions.js';

export function registerFinanceLedgerExtras(financeLedgerCmd: Command): void {
  const program = financeLedgerCmd.parent;
  const getFormat = (): string => (program?.opts()['format'] as string | undefined) ?? 'json';

  registerJsonBatchAction(financeLedgerCmd, {
    command: 'batch-update-subject',
    description: '批量修改公司流水科目（PATCH /finance-ledger/batch-update-subject，仅 admin）',
    method: 'PATCH',
    path: '/finance-ledger/batch-update-subject',
    schema: batchUpdateSubjectSchema,
  });

  financeLedgerCmd
    .command('unlink-payment <id>')
    .description('解绑公司流水与回款（POST /finance-ledger/:id/unlink-payment，仅 admin）')
    .requiredOption('--json <path>', 'body JSON：{ reason }')
    .option('--dry-run', '只打印 POST 请求体，不实际发起')
    .action(async (id: string, opts: { json: string; dryRun?: boolean }) => {
      const body = parseJsonWithSchema(unlinkPaymentSchema, opts.json, '--json');
      const path = `/finance-ledger/${encodeUuidPathId(id, 'id')}/unlink-payment`;
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

  financeLedgerCmd
    .command('link-payment <id>')
    .description('绑定公司流水到回款（POST /finance-ledger/:id/link-payment，仅 admin）')
    .requiredOption('--json <path>', 'body JSON：{ paymentId, reason }')
    .option('--dry-run', '只打印 POST 请求体，不实际发起')
    .action(async (id: string, opts: { json: string; dryRun?: boolean }) => {
      const body = parseJsonWithSchema(linkPaymentSchema, opts.json, '--json');
      const path = `/finance-ledger/${encodeUuidPathId(id, 'id')}/link-payment`;
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
