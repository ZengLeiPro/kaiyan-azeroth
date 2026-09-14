import { Command } from 'commander';

import { login as doLogin, logout as doLogout, request } from '../client.js';
import { CliError, fatal, printJson, readSecret } from '../utils.js';

export function registerAuthCommands(program: Command): void {
  program
    .command('login')
    .description('Authenticate without placing the password in argv/process title/shell history')
    .requiredOption('-u, --username <username>', 'Username')
    .option('--password-stdin', 'Read the password from piped stdin')
    .option('--password-file <path>', 'Read the password from a regular file with mode 0600')
    .action(async (opts: { username: string; passwordStdin?: boolean; passwordFile?: string }) => {
      try {
        const password = await readSecret({
          stdin: opts.passwordStdin,
          file: opts.passwordFile,
          prompt: 'Password: ',
          label: 'Password',
        });
        const auth = await doLogin({
          username: opts.username,
          password,
        });
        printJson({
          status: 'ok',
          user: auth.user.username,
          employee: auth.user.employee?.name ?? null,
          expiresAt: new Date(auth.expiresAt).toISOString(),
        });
      } catch (err) {
        if (err instanceof CliError) throw err;
        if (err instanceof Error) fatal('Login failed', err.message);
        throw err;
      }
    });

  program
    .command('logout')
    .description('Clear stored credentials')
    .action(async () => {
      await doLogout();
      printJson({ status: 'ok', message: 'Logged out' });
    });

  program
    .command('whoami')
    .description(
      'Show current user info (always queries server for the real identity behind current token)'
    )
    .action(async () => {
      // 始终走服务端，避免本地 auth.json 缓存与 env AZEROTH_TOKEN 实际身份不一致
      // （PAT 模式下 auth.json 可能仍是上次 admin login 的残留）
      const me = await request<{
        id: string;
        username: string;
        employee?: { id: string; name: string } | null;
        roles?: Array<{ code: string; name: string }>;
      }>('GET', '/users/me');
      const authType = process.env['AZEROTH_TOKEN'] ? 'pat' : 'jwt';
      printJson({
        authType,
        username: me.username,
        userId: me.id,
        employee: me.employee ?? null,
        roles: me.roles?.map((r) => r.code) ?? [],
      });
    });
}
