/**
 * azeroth users —— 用户状态切换 / 改密 / 选择器列表 子命令组（追挂模式）
 *
 * 设计说明：
 *   - users 的 list/get/create/update/delete 由自动发现 CRUD 模板注册。
 *   - 后端 UsersController 另外暴露 3 个非标 endpoint，全部在此追挂：
 *     - PATCH /users/:id/status       管理员切换用户启用/禁用/锁定
 *     - PATCH /users/me/password      当前登录用户修改自己的密码
 *     - GET   /users/all              选择器专用（不分页，仅返回 id/username/phone/employeeName）
 *
 *   `azeroth whoami` 已经覆盖 GET /users/me（在 commands/auth.ts 中），
 *   所以这里不再重复加 `users me`。
 *
 *   change-password 走当前 JWT 身份，不接受 --user-id（这是 me/password 而非 :id/password）。
 *   admin 重置他人密码请走 `azeroth users update <id> --password <new>`。
 */

import {
  changePasswordSchema,
  updateUserStatusSchema,
  USER_STATUS,
  type UserSelectionQueryInput,
  userSelectionQuerySchema,
} from '@ky-azeroth/shared';
import { Command } from 'commander';

import { request } from '../client.js';
import {
  encodeUuidPathId,
  fatal,
  output,
  parseJsonWithSchema,
  printJson,
  readSecret,
} from '../utils.js';

interface UserSelectionItem {
  id: string;
  username: string;
  phone: string | null;
  employeeName: string | null;
}

export function registerUsersExtras(usersCmd: Command): void {
  const program = usersCmd.parent;
  const getFormat = (): string => (program?.opts()['format'] as string | undefined) ?? 'json';

  // ── update-status ─────────────────────────────────────────────────
  // PATCH /users/:id/status，body = { status: 'active' | 'disabled' }
  // 后端 schema 仅接受 ACTIVE/DISABLED（不接受 LOCKED——locked 是系统因登录失败自动置位）。
  // DISABLED 会吊销目标用户的全部 session/PAT，必须显式 --yes；ACTIVE 是恢复性操作。
  usersCmd
    .command('update-status <id>')
    .description('切换用户启用/禁用；禁用会吊销目标用户的全部 session/PAT')
    .option('--status <s>', `目标状态：${USER_STATUS.ACTIVE} | ${USER_STATUS.DISABLED}`)
    .option('--json <path>', '或用 JSON 文件传入 body { status }')
    .option('--dry-run', '预览请求体，不实际发起；无需 --yes')
    .option('--yes', '确认禁用并吊销全部凭据（status=disabled 非 dry-run 时必填）')
    .action(
      async (
        id: string,
        opts: { status?: string; json?: string; dryRun?: boolean; yes?: boolean }
      ) => {
        let body: { status: string };
        if (opts.json) {
          body = parseJsonWithSchema(updateUserStatusSchema, opts.json, '--json');
        } else if (opts.status) {
          const parsed = updateUserStatusSchema.safeParse({ status: opts.status });
          if (!parsed.success) {
            fatal('Invalid --status', {
              issues: parsed.error.issues.map((i) => ({
                path: i.path.join('.') || '(root)',
                message: i.message,
              })),
            });
          }
          body = parsed.data;
        } else {
          fatal('Missing --status or --json');
        }

        const path = `/users/${encodeUuidPathId(id)}/status`;
        if (opts.dryRun) {
          printJson({ method: 'PATCH', path, body });
          return;
        }
        if (body.status === USER_STATUS.DISABLED && !opts.yes) {
          fatal('Missing --yes', {
            operation: 'users update-status',
            status: body.status,
            hint: 'Disabling a user revokes all sessions and PATs; pass --yes to confirm',
          });
        }
        const result = await request<{ success: boolean }>(
          'PATCH',
          path,
          body as unknown as Record<string, unknown>
        );
        output(result, getFormat());
      }
    );

  // ── change-password ───────────────────────────────────────────────
  // PATCH /users/me/password，body = { currentPassword, newPassword, confirmPassword }
  // schema 强约束：新密码 ≥8 位 + 大小写字母 + 数字 + 两次确认一致。
  // 操作对象是「当前 JWT 身份」，不是 :id——admin 改他人密码走 users update <id> --password。
  usersCmd
    .command('change-password')
    .description('修改当前登录用户密码；密码只从隐藏 TTY、stdin 或 mode-0600 文件读取')
    .option(
      '--password-stdin',
      '从 stdin 读取完整 JSON：{ currentPassword,newPassword,confirmPassword }'
    )
    .option('--password-file <path>', '从 mode-0600 JSON 文件读取完整密码 body')
    .option('--dry-run', '只打印递归脱敏后的请求体，不实际发起')
    .action(async (opts: { passwordStdin?: boolean; passwordFile?: string; dryRun?: boolean }) => {
      if (opts.passwordStdin && opts.passwordFile) {
        fatal('Choose exactly one password source');
      }
      let body: {
        currentPassword: string;
        newPassword: string;
        confirmPassword: string;
      };
      if (opts.passwordStdin || opts.passwordFile) {
        body = parseJsonWithSchema(
          changePasswordSchema,
          opts.passwordStdin ? '-' : opts.passwordFile!,
          opts.passwordStdin ? '--password-stdin' : '--password-file'
        );
      } else {
        const currentPassword = await readSecret({
          prompt: 'Current password: ',
          label: 'Password',
        });
        const newPassword = await readSecret({ prompt: 'New password: ', label: 'Password' });
        const confirmPassword = await readSecret({
          prompt: 'Confirm new password: ',
          label: 'Password',
        });
        const parsed = changePasswordSchema.safeParse({
          currentPassword,
          newPassword,
          confirmPassword,
        });
        if (!parsed.success) {
          fatal('Invalid password input', {
            issues: parsed.error.issues.map((i) => ({
              path: i.path.join('.') || '(root)',
              message: i.message,
            })),
          });
        }
        body = parsed.data;
      }

      const path = '/users/me/password';
      if (opts.dryRun) {
        printJson({ method: 'PATCH', path, body });
        return;
      }
      const result = await request<{ success: boolean }>(
        'PATCH',
        path,
        body as unknown as Record<string, unknown>
      );
      output(result, getFormat());
    });

  // ── list-all ──────────────────────────────────────────────────────
  // GET /users/all，选择器专用（不分页）。
  // 与标准 `users list` 的差异：返回字段更少（id/username/phone/employeeName），不带分页元数据，
  // 适合 Agent / 下拉控件批量拉。
  usersCmd
    .command('list-all')
    .description('查询全部用户（选择器视图，GET /users/all，不分页）')
    .option('--status <s>', `用户状态过滤：${Object.values(USER_STATUS).join(' | ')}`)
    .option('--keyword <kw>', '关键词搜索（用户名 / 手机号 / 员工名）')
    .action(async (opts: { status?: string; keyword?: string }) => {
      const raw: Record<string, unknown> = {};
      if (opts.status) raw['status'] = opts.status;
      if (opts.keyword) raw['keyword'] = opts.keyword;

      const parsed = userSelectionQuerySchema.safeParse(raw);
      if (!parsed.success) {
        fatal('Invalid options', {
          issues: parsed.error.issues.map((i) => ({
            path: i.path.join('.') || '(root)',
            message: i.message,
          })),
        });
      }
      const query = parsed.data as UserSelectionQueryInput;
      const result = await request<UserSelectionItem[]>(
        'GET',
        '/users/all',
        undefined,
        query as unknown as Record<string, unknown>
      );
      const format = getFormat();
      if (format === 'table') {
        output(result, format, {
          columns: ['id', 'username', 'phone', 'employeeName'],
        });
      } else {
        output(result, format);
      }
    });
}
