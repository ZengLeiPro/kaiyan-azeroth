/**
 * azeroth payroll —— 薪资周期 / 导入流水 / 批删 子命令组（追挂模式）
 *
 * 设计说明：
 *   - payroll 的 list/get/create/update/delete 由自动发现 CRUD 模板注册。
 *   - 后端 PayrollController 另外暴露 5 个非标 endpoint，全部在此追挂：
 *     - GET  /payroll/periods                查询薪资周期汇总（按 yyyy-MM 归并）
 *     - GET  /payroll/import-batches         查询历次导入批次列表
 *     - GET  /payroll/import-batches/:id     查询单个导入批次详情
 *     - POST /payroll/import/preview         上传 Excel 预览（行级 issues + 汇总）
 *     - POST /payroll/import/commit          确认提交（replace_period 整周期替换）
 *     - POST /payroll/batch-delete           版本化批量删除（兼容路由，最多 200 条）
 *
 *   导入流程：
 *     1. 业务端上传 .xlsx，拿到 FileAsset id
 *     2. CLI: `azeroth payroll preview-import --file-asset-id <id>` → 看 issues
 *     3. 修复 Excel 后重传 → 再 preview-import → 0 error
 *     4. CLI: `azeroth payroll commit-import --file-asset-id <id> [--strategy replace_period]`
 *
 *   3 月 + 4 月 22 条手工录入是历史，下次导入可走此 CLI 链路。
 */

import {
  batchPayrollDeleteSchema,
  type PayrollImportBatchResponseOutput,
  type PayrollImportCommitResponseOutput,
  payrollImportCommitSchema,
  payrollImportPreviewInputSchema,
  type PayrollImportPreviewResponseOutput,
  type PayrollPeriodSummaryOutput,
} from '@ky-azeroth/shared';
import { Command, Option } from 'commander';

import { request } from '../client.js';
import { encodeUuidPathId, fatal, output, parseJsonWithSchema, printJson } from '../utils.js';

export function registerPayrollExtras(payrollCmd: Command): void {
  const program = payrollCmd.parent;
  const getFormat = (): string => (program?.opts()['format'] as string | undefined) ?? 'json';

  // ── list-periods ──────────────────────────────────────────────────
  // GET /payroll/periods，返回 { items: PayrollPeriodSummary[] }（按 yyyy-MM 归并）
  payrollCmd
    .command('list-periods')
    .description('查询薪资周期汇总（GET /payroll/periods）')
    .action(async () => {
      const result = await request<{ items: PayrollPeriodSummaryOutput[] }>(
        'GET',
        '/payroll/periods'
      );
      const format = getFormat();
      if (format === 'table') {
        output(result.items, format, {
          columns: ['period', 'recordCount', 'totalAmount', 'createdAt'],
        });
      } else {
        output(result, format);
      }
    });

  // ── list-import-batches ───────────────────────────────────────────
  payrollCmd
    .command('list-import-batches')
    .description('查询导入批次列表（GET /payroll/import-batches）')
    .action(async () => {
      const result = await request<{ items: PayrollImportBatchResponseOutput[] }>(
        'GET',
        '/payroll/import-batches'
      );
      const format = getFormat();
      if (format === 'table') {
        output(result.items, format, {
          columns: ['id', 'status', 'totalRows', 'committedRows', 'createdAt'],
        });
      } else {
        output(result, format);
      }
    });

  // ── get-import-batch ──────────────────────────────────────────────
  payrollCmd
    .command('get-import-batch <id>')
    .description('查询单个导入批次详情（GET /payroll/import-batches/:id）')
    .action(async (id: string) => {
      const result = await request<PayrollImportBatchResponseOutput>(
        'GET',
        `/payroll/import-batches/${encodeUuidPathId(id, 'id')}`
      );
      output(result, getFormat());
    });

  // ── preview-import ────────────────────────────────────────────────
  // POST /payroll/import/preview，body = { fileAssetId, fileUrl? }
  // 后端解析 Excel 返回 issues + 汇总，不入库；commit 前必须 preview 一次。
  payrollCmd
    .command('preview-import')
    .description('预览薪资导入（POST /payroll/import/preview，不入库）')
    .option('--file-asset-id <id>', '上传接口返回的 FileAsset UUID（必填）')
    .option('--file-url <url>', '可选，仅用于回显兼容，服务端不按 URL 解析文件')
    .option('--json <path>', '或用 JSON 文件传入 body { fileAssetId, fileUrl? }')
    .option('--dry-run', '只打印请求体，不实际发起')
    .action(
      async (opts: { fileAssetId?: string; fileUrl?: string; json?: string; dryRun?: boolean }) => {
        let body: { fileAssetId: string; fileUrl?: string };
        if (opts.json) {
          body = parseJsonWithSchema(payrollImportPreviewInputSchema, opts.json, '--json');
        } else if (opts.fileAssetId) {
          const parsed = payrollImportPreviewInputSchema.safeParse({
            fileAssetId: opts.fileAssetId,
            fileUrl: opts.fileUrl,
          });
          if (!parsed.success) {
            fatal('Invalid --file-asset-id/--file-url', {
              issues: parsed.error.issues.map((i) => ({
                path: i.path.join('.') || '(root)',
                message: i.message,
              })),
            });
          }
          body = parsed.data;
        } else {
          fatal('Missing --file-asset-id or --json');
        }

        const path = '/payroll/import/preview';
        if (opts.dryRun) {
          printJson({ method: 'POST', path, body });
          return;
        }
        const result = await request<PayrollImportPreviewResponseOutput>(
          'POST',
          path,
          body as unknown as Record<string, unknown>
        );
        output(result, getFormat());
      }
    );

  // ── commit-import ─────────────────────────────────────────────────
  // POST /payroll/import/commit，body = { fileAssetId, fileUrl?, strategy }
  // strategy 当前仅支持 'replace_period'（整周期替换）。
  payrollCmd
    .command('commit-import')
    .description('提交薪资导入（POST /payroll/import/commit，落库 + 整周期替换）')
    .option('--file-asset-id <id>', '上传接口返回的 FileAsset UUID（必填，应与 preview 同一份）')
    .option('--file-url <url>', '可选，仅用于回显兼容，服务端不按 URL 解析文件')
    .addOption(
      new Option('--strategy <s>', '导入策略').choices(['replace_period']).default('replace_period')
    )
    .option('--json <path>', '或用 JSON 文件传入完整 body')
    .option('--dry-run', '只打印请求体，不实际发起')
    .option('--yes', '确认整周期替换（非 dry-run 必填）')
    .action(
      async (opts: {
        fileAssetId?: string;
        fileUrl?: string;
        strategy?: string;
        json?: string;
        dryRun?: boolean;
        yes?: boolean;
      }) => {
        let body: { fileAssetId: string; fileUrl?: string; strategy: 'replace_period' };
        if (opts.json) {
          body = parseJsonWithSchema(payrollImportCommitSchema, opts.json, '--json');
        } else if (opts.fileAssetId) {
          const parsed = payrollImportCommitSchema.safeParse({
            fileAssetId: opts.fileAssetId,
            fileUrl: opts.fileUrl,
            strategy: opts.strategy ?? 'replace_period',
          });
          if (!parsed.success) {
            fatal('Invalid options', {
              issues: parsed.error.issues.map((i) => ({
                path: i.path.join('.') || '(root)',
                message: i.message,
              })),
            });
          }
          body = parsed.data;
        } else {
          fatal('Missing --file-asset-id or --json');
        }

        const path = '/payroll/import/commit';
        if (opts.dryRun) {
          printJson({ method: 'POST', path, body });
          return;
        }
        if (!opts.yes) fatal('Payroll import commit requires --yes');
        const result = await request<PayrollImportCommitResponseOutput>(
          'POST',
          path,
          body as unknown as Record<string, unknown>
        );
        output(result, getFormat());
      }
    );

  // ── batch-delete ──────────────────────────────────────────────────
  // POST /payroll/batch-delete，body = { ids, versions }（最多 200）。
  // CLI 保留 POST 兼容路由；Web 使用语义一致的标准 DELETE /payroll/batch。
  payrollCmd
    .command('batch-delete')
    .description('版本化批量删除薪资记录（POST /payroll/batch-delete，最多 200 条）')
    .option('--ids <id...>', 'ID 列表（必须与 --versions 的键精确一一对应）')
    .option('--versions <json>', '逐行版本映射 JSON，例如 {"<id>":3,"<id2>":8}')
    .option('--json <path>', '或用 JSON 文件传入完整 body { ids: [...], versions: {...} }')
    .option('--dry-run', '只打印请求体，不实际发起')
    .option('--yes', '确认批量删除（非 dry-run 必填）')
    .action(
      async (opts: {
        ids?: string[];
        versions?: string;
        json?: string;
        dryRun?: boolean;
        yes?: boolean;
      }) => {
        let body: { ids: string[]; versions: Record<string, number> };
        if (opts.json) {
          body = parseJsonWithSchema(batchPayrollDeleteSchema, opts.json, '--json');
        } else if (opts.ids && opts.ids.length > 0 && opts.versions) {
          let versions: unknown;
          try {
            versions = JSON.parse(opts.versions);
          } catch (error) {
            fatal('Invalid JSON for --versions', {
              reason: error instanceof Error ? error.message : String(error),
            });
          }
          const parsed = batchPayrollDeleteSchema.safeParse({ ids: opts.ids, versions });
          if (!parsed.success) {
            fatal('Invalid --ids/--versions', {
              issues: parsed.error.issues.map((i) => ({
                path: i.path.join('.') || '(root)',
                message: i.message,
              })),
            });
          }
          body = parsed.data;
        } else {
          fatal('Missing --ids + --versions or --json');
        }

        const path = '/payroll/batch-delete';
        if (opts.dryRun) {
          printJson({ method: 'POST', path, body });
          return;
        }
        if (!opts.yes) fatal('Payroll batch-delete requires --yes');
        const result = await request<{
          success: number;
          failed: number;
          errors: Array<{ id: string; error: string }>;
        }>('POST', path, body as unknown as Record<string, unknown>);
        output(result, getFormat());
      }
    );
}
