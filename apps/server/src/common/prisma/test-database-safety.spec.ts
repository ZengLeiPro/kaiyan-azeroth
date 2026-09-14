import { describe, expect, it } from 'vitest';

import { assertSafeTestDatabaseConnection } from './test-database-safety';

describe('assertSafeTestDatabaseConnection', () => {
  it('允许本机专用测试数据库', () => {
    expect(() =>
      assertSafeTestDatabaseConnection({
        nodeEnv: 'test',
        databaseUrl: 'postgresql://postgres:postgres@localhost:5432/ky-azeroth-test?schema=public',
      })
    ).not.toThrow();
  });

  it('允许 Docker Compose 服务名 postgres 指向同一测试库', () => {
    expect(() =>
      assertSafeTestDatabaseConnection({
        nodeEnv: 'test',
        databaseUrl: 'postgresql://postgres:postgres@postgres:5432/ky-azeroth-test?schema=public',
      })
    ).not.toThrow();
  });

  it('拒绝非测试环境', () => {
    expect(() =>
      assertSafeTestDatabaseConnection({
        nodeEnv: 'production',
        databaseUrl: 'postgresql://postgres:postgres@localhost:5432/ky-azeroth-test?schema=public',
      })
    ).toThrow('NODE_ENV 必须为 test');
  });

  it.each([
    ['生产数据库名', 'postgresql://postgres:secret@localhost:5432/ky-azeroth?schema=public'],
    [
      '伪装测试数据库名',
      'postgresql://postgres:secret@localhost:5432/ky-azeroth-test-backup?schema=public',
    ],
    [
      '远程数据库主机',
      'postgresql://postgres:secret@pgm-production.example.com:5432/ky-azeroth-test?schema=public',
    ],
    [
      '非测试数据库用户',
      'postgresql://app_user:secret@localhost:5432/ky-azeroth-test?schema=public',
    ],
  ])('拒绝%s', (_label, databaseUrl) => {
    expect(() =>
      assertSafeTestDatabaseConnection({
        nodeEnv: 'test',
        databaseUrl,
      })
    ).toThrow('拒绝执行破坏性测试数据库操作');
  });

  it('拒绝缺失或无效的数据库地址且不泄露密码', () => {
    expect(() =>
      assertSafeTestDatabaseConnection({
        nodeEnv: 'test',
        databaseUrl: undefined,
      })
    ).toThrow('DATABASE_URL 未设置');

    try {
      assertSafeTestDatabaseConnection({
        nodeEnv: 'test',
        databaseUrl: 'not-a-valid-url-with-super-secret',
      });
      throw new Error('预期安全检查抛错');
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).not.toContain('super-secret');
    }
  });
});
