/**
 * azeroth web-events —— 官网埋点事件追挂命令（archive）
 *
 * 设计说明：
 *   - list / get 由自动派生 CRUD 模板注册（registry.ts Pass 2 只读两件套）。
 *   - 唯一非标动作：archive —— admin-only，按时间范围 + 可选 path 删除事件。
 *     用 POST /web-events/archive，body 走 shared `archiveWebEventsSchema` 校验。
 *   - 双闸门：服务端 schema 已 refine（dryRun=false 必须配 yes=true），CLI 端
 *     还是把 --dry-run / --yes 显式露出，避免误调。dryRun 默认 true。
 *
 * 取代了原直连数据库归档脚本。
 */

import { archiveWebEventsSchema } from '@ky-azeroth/shared';
import { Command } from 'commander';

import { request } from '../client.js';
import { fatal, output } from '../utils.js';

interface ArchiveOpts {
  before?: string;
  path?: string;
  dryRun?: boolean;
  yes?: boolean;
}

interface ArchiveResult {
  matched: number;
  deleted: number;
  dryRun: boolean;
}

export function registerWebEventsExtras(webEventsCmd: Command): void {
  const program = webEventsCmd.parent;
  const getFormat = (): string => (program?.opts()['format'] as string | undefined) ?? 'json';

  // ── archive ────────────────────────────────────────────────────────
  // POST /web-events/archive，admin-only。默认 dryRun=true 只返影响行数。
  webEventsCmd
    .command('archive')
    .description(
      '归档官网埋点事件（POST /web-events/archive，仅 ADMIN）。' +
        '默认 dryRun=true 只返影响行数；真删必须 --no-dry-run + --yes。'
    )
    .option('--before <date>', '删除该时间之前的事件（ISO 字符串或 yyyy-MM-dd，必填）')
    .option('--path <path>', '仅删除指定 path 的事件（如 /__test__/，可选）')
    .option('--dry-run', '只返影响行数不真删（默认开启）', true)
    .option('--no-dry-run', '关闭 dry-run，准备真删（仍需配 --yes）')
    .option('--yes', '真删确认（不可恢复，--no-dry-run 时必填）')
    .action(async (opts: ArchiveOpts) => {
      if (!opts.before) {
        fatal('Missing --before', 'Pass --before <iso-date|yyyy-MM-dd>');
      }
      // commander --dry-run/--no-dry-run 默认 true，--no-dry-run 后变 false
      const dryRun = opts.dryRun !== false;
      const yes = opts.yes === true;

      // CLI 端先用 shared schema 走一次校验，让 server 端校验失败前 fail-fast
      const body = archiveWebEventsSchema.parse({
        before: opts.before,
        path: opts.path,
        dryRun,
        yes,
      });

      const path = '/web-events/archive';
      if (dryRun) {
        // 调用服务端 dry-run（返 matched 行数）
        const result = await request<ArchiveResult>('POST', path, body as Record<string, unknown>);
        output(result, getFormat());
        return;
      }

      // 真删路径
      if (!yes) {
        fatal(
          'Missing --yes',
          'Archive is irreversible. Pass --yes to confirm, or omit --no-dry-run to preview'
        );
      }
      const result = await request<ArchiveResult>('POST', path, body as Record<string, unknown>);
      output(result, getFormat());
    });
}
