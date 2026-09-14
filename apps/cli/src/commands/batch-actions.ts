import { Command } from 'commander';
import { z } from 'zod';

import { request } from '../client.js';
import { fatal, output, parseJsonWithSchema, printJson } from '../utils.js';

type HttpMethod = 'PATCH' | 'POST' | 'DELETE';

interface BatchActionConfig {
  command: string;
  description: string;
  method: HttpMethod;
  path: string;
  schema: z.ZodTypeAny;
}

interface BatchActionOptions {
  json?: string;
  dryRun?: boolean;
  yes?: boolean;
}

export function registerJsonBatchAction(entityCmd: Command, config: BatchActionConfig): void {
  const program = entityCmd.parent;
  const getFormat = (): string => (program?.opts()['format'] as string | undefined) ?? 'json';

  entityCmd
    .command(config.command)
    .description(config.description)
    .requiredOption('--json <path>', 'body JSON 文件路径或 "-"（stdin）')
    .option('--dry-run', '只打印请求体，不实际发起')
    .option('--yes', '确认执行批量写操作（非 dry-run 必填）')
    .action(async (opts: BatchActionOptions) => {
      const body = parseJsonWithSchema(config.schema, opts.json!, '--json');
      if (opts.dryRun) {
        printJson({ method: config.method, path: config.path, body });
        return;
      }
      if (!opts.yes) {
        fatal('Batch write requires --yes', {
          hint: 'Use --dry-run first, then repeat with --yes',
        });
      }
      const result = await request(config.method, config.path, body as Record<string, unknown>);
      output(result, getFormat());
    });
}
