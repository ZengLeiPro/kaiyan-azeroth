import { bindEmployeeDingtalkSchema, unbindEmployeeDingtalkSchema } from '@ky-azeroth/shared';
import { Command } from 'commander';

import { request } from '../client.js';
import { encodeUuidPathId, fatal, output, parseJsonWithSchema, printJson } from '../utils.js';

interface DingtalkBindingOptions {
  json: string;
  dryRun?: boolean;
  yes?: boolean;
}

export function registerEmployeesExtras(employeesCmd: Command): void {
  const program = employeesCmd.parent;
  const getFormat = (): string => (program?.opts()['format'] as string | undefined) ?? 'json';

  employeesCmd
    .command('bind-dingtalk <id>')
    .description('管理员 CAS 绑定/替换员工钉钉身份')
    .requiredOption('--json <path>', 'body JSON 文件路径或 "-"（stdin）')
    .option('--dry-run', '校验并打印请求，不实际发起')
    .option('--yes', '确认执行高风险身份绑定（非 dry-run 必填）')
    .action(async (id: string, opts: DingtalkBindingOptions) => {
      const path = `/employees/${encodeUuidPathId(id, 'employee id')}/dingtalk-binding`;
      const body = parseJsonWithSchema(bindEmployeeDingtalkSchema, opts.json, '--json');
      if (opts.dryRun) {
        printJson({ method: 'PUT', path, body });
        return;
      }
      if (!opts.yes) {
        fatal('DingTalk binding requires --yes', {
          hint: 'Use --dry-run first, then repeat with --yes',
        });
      }
      const result = await request('PUT', path, body);
      output(result, getFormat());
    });

  employeesCmd
    .command('unbind-dingtalk <id>')
    .description('管理员 CAS 解绑员工钉钉身份')
    .requiredOption('--json <path>', 'body JSON 文件路径或 "-"（stdin）')
    .option('--dry-run', '校验并打印请求，不实际发起')
    .option('--yes', '确认执行高风险身份解绑（非 dry-run 必填）')
    .action(async (id: string, opts: DingtalkBindingOptions) => {
      const path = `/employees/${encodeUuidPathId(id, 'employee id')}/dingtalk-binding`;
      const body = parseJsonWithSchema(unbindEmployeeDingtalkSchema, opts.json, '--json');
      if (opts.dryRun) {
        printJson({ method: 'DELETE', path, body });
        return;
      }
      if (!opts.yes) {
        fatal('DingTalk unbinding requires --yes', {
          hint: 'Use --dry-run first, then repeat with --yes',
        });
      }
      const result = await request('DELETE', path, body);
      output(result, getFormat());
    });
}
