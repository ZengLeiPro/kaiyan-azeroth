/**
 * azeroth crm-products —— 软删除回收站子命令组（追挂模式）
 *
 * 设计说明：
 *   - crm-products 的 list/get/create/update/delete/restore 由自动 CRUD + RESTORE_SUPPORTED
 *     注册（CrmProduct 已在 RESTORE_SUPPORTED 集合中）。
 *   - 本文件追挂 2 条非标 endpoint：
 *     - GET    /crm-products/trash             回收站列表（已软删除产品）
 *     - DELETE /crm-products/:id/permanent     永久删除（不可逆，加 --yes）
 *   - GET /crm-products/all 的 selection 端点按 2026-06-13 决策"先不做"，跳过。
 *   - 与 customers.ts 的 trash / permanent-delete 模式完全一致，保持一致性。
 */

import { type CrmProductResponseOutput, queryCrmProductSchema } from '@ky-azeroth/shared';
import { Command } from 'commander';

import { request } from '../client.js';
import {
  encodeUuidPathId,
  fatal,
  output,
  parsePositiveInt,
  printJson,
  validateWithSchema,
} from '../utils.js';

interface CrmProductListResponse {
  items: CrmProductResponseOutput[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export function registerCrmProductsExtras(crmProductsCmd: Command): void {
  const program = crmProductsCmd.parent;
  const getFormat = (): string => (program?.opts()['format'] as string | undefined) ?? 'json';

  // ── trash ────────────────────────────────────────────────────────
  crmProductsCmd
    .command('trash')
    .description('回收站列表：已软删除的产品（GET /crm-products/trash，分页）')
    .option('--page <n>', '页码（默认 1）')
    .option('--page-size <n>', '每页条数（默认 100）')
    .option('--keyword <q>', '关键词搜索')
    .option('--category <c>', '产品分类过滤')
    .action(
      async (opts: { page?: string; pageSize?: string; keyword?: string; category?: string }) => {
        // 用 shared queryCrmProductSchema 做形态校验（仅过滤 known fields），避免误传字段
        const raw: Record<string, unknown> = {};
        if (opts.page) raw['page'] = parsePositiveInt(opts.page, '--page');
        if (opts.pageSize) raw['pageSize'] = parsePositiveInt(opts.pageSize, '--page-size');
        if (opts.keyword) raw['keyword'] = opts.keyword;
        if (opts.category) raw['category'] = opts.category;
        const params = validateWithSchema(queryCrmProductSchema, raw, 'trash query');
        const result = await request<CrmProductListResponse>(
          'GET',
          '/crm-products/trash',
          undefined,
          params as Record<string, unknown>
        );
        output(result, getFormat());
      }
    );

  // ── permanent-delete ─────────────────────────────────────────────
  // 不可逆，需 --yes 显式确认；dry-run 优先于 --yes 检查（与 customers.permanent-delete 一致）。
  crmProductsCmd
    .command('permanent-delete <id>')
    .description('物理删除产品（DELETE /crm-products/:id/permanent，不可逆）')
    .option('--yes', '确认永久删除（不可逆，必须显式带）')
    .option('--dry-run', '只打印请求路径，不实际发起')
    .action(async (id: string, opts: { yes?: boolean; dryRun?: boolean }) => {
      const path = `/crm-products/${encodeUuidPathId(id, 'id')}/permanent`;
      if (opts.dryRun) {
        printJson({ method: 'DELETE', path, body: {} });
        return;
      }
      if (!opts.yes) {
        fatal('Refusing to permanent-delete without --yes', '永久删除不可逆。如确认，加 --yes');
      }
      const result = await request<{ success: boolean }>('DELETE', path);
      output(result, getFormat());
    });
}
