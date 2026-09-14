import { readFileSync, statSync } from 'node:fs';

const MIN_PASSWORD_LENGTH = 16;

export function readPasswordFile(envName: string): string {
  const filePath = process.env[envName]?.trim();
  if (!filePath) {
    throw new Error(
      `${envName} 必须指向仓外密码文件（chmod 600）。公开副本不会在仓库或 README 中写入任何默认密码。`
    );
  }

  const stat = statSync(filePath);
  if (!stat.isFile()) {
    throw new Error(`${envName} 不是普通文件: ${filePath}`);
  }
  if ((stat.mode & 0o077) !== 0) {
    throw new Error(`${envName} 权限过宽，必须 chmod 600: ${filePath}`);
  }

  const password = readFileSync(filePath, 'utf8').trim();
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`${envName} 中的密码至少 ${MIN_PASSWORD_LENGTH} 个字符`);
  }
  if (password.includes('\n') || password.includes('\r')) {
    throw new Error(`${envName} 只能包含单行密码`);
  }
  return password;
}

export function assertLocalSeedAllowed(databaseUrl: string | undefined): void {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('拒绝在 production 环境执行 seed / bootstrap。');
  }
  if (!databaseUrl) {
    throw new Error('DATABASE_URL 未配置');
  }
  if (/rds\.aliyuncs\.com|\.pg\.rds\./i.test(databaseUrl)) {
    throw new Error('拒绝对云数据库执行 seed / bootstrap。');
  }
}
