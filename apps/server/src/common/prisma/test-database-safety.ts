const ALLOWED_TEST_DATABASE_HOSTS = new Set([
  'localhost',
  '127.0.0.1',
  '::1',
  '[::1]',
  'postgres',
]);
const ALLOWED_TEST_DATABASE_NAME = 'ky-azeroth-test';
const ALLOWED_TEST_DATABASE_USER = 'postgres';

interface TestDatabaseConnectionInput {
  nodeEnv: string | undefined;
  databaseUrl: string | undefined;
}

/**
 * 破坏性测试数据库操作的最终安全边界。
 *
 * 不能只检查 NODE_ENV 或数据库名包含 "test"：二者都可能被外部环境误配。
 * 当前 E2E 基础设施只允许本机 postgres 用户连接固定测试库。
 */
export function assertSafeTestDatabaseConnection({
  nodeEnv,
  databaseUrl,
}: TestDatabaseConnectionInput): void {
  if (nodeEnv !== 'test') {
    throw new Error('拒绝执行破坏性测试数据库操作：NODE_ENV 必须为 test');
  }

  if (!databaseUrl) {
    throw new Error('拒绝执行破坏性测试数据库操作：DATABASE_URL 未设置');
  }

  let parsed: URL;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    throw new Error('拒绝执行破坏性测试数据库操作：DATABASE_URL 格式无效');
  }

  const protocolAllowed = parsed.protocol === 'postgresql:' || parsed.protocol === 'postgres:';
  const host = parsed.hostname;
  const databaseName = decodeURIComponent(parsed.pathname.replace(/^\/+/, ''));
  const username = decodeURIComponent(parsed.username);

  if (
    !protocolAllowed ||
    !ALLOWED_TEST_DATABASE_HOSTS.has(host) ||
    databaseName !== ALLOWED_TEST_DATABASE_NAME ||
    username !== ALLOWED_TEST_DATABASE_USER
  ) {
    throw new Error(
      '拒绝执行破坏性测试数据库操作：' +
        `仅允许 ${ALLOWED_TEST_DATABASE_USER}@localhost/${ALLOWED_TEST_DATABASE_NAME}，` +
        `当前为 ${username || '(空用户)'}@${host || '(空主机)'}/${databaseName || '(空库名)'}`
    );
  }
}
