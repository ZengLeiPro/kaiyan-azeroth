import { describe, expect, it } from 'vitest';

import { validateEnv } from './env.validation';

const superAdminEmployeeId = '11111111-1111-4111-8111-111111111111';

const baseEnv = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
  JWT_SECRET: 'test-jwt-secret-key-for-testing-only',
  JWT_REFRESH_SECRET: 'test-refresh-secret-key-for-testing-only',
  CORS_ORIGIN: 'http://localhost:5173',
  BCRYPT_ROUNDS: '4',
};

describe('validateEnv', () => {
  it('补齐默认值并校验关键安全配置', () => {
    const env = validateEnv(baseEnv);

    expect(env.NODE_ENV).toBe('test');
    expect(env.PORT).toBe(3000);
    expect(env.API_PREFIX).toBe('api');
    expect(env.BCRYPT_ROUNDS).toBe(4);
  });

  it('禁止 refresh secret 回落或等同 access secret', () => {
    expect(() =>
      validateEnv({
        ...baseEnv,
        JWT_REFRESH_SECRET: baseEnv.JWT_SECRET,
      })
    ).toThrow(/JWT_REFRESH_SECRET 必须与 JWT_SECRET 相互独立/);
  });

  it('生产环境禁止弱 bcrypt rounds 与通配 CORS', () => {
    expect(() =>
      validateEnv({
        ...baseEnv,
        NODE_ENV: 'production',
        CORS_ORIGIN: '*',
        BCRYPT_ROUNDS: '4',
      })
    ).toThrow(/生产环境禁止 CORS_ORIGIN=\*|生产环境 BCRYPT_ROUNDS 必须至少为 12/);
  });

  it('生产环境禁止测试 refresh secret 占位值', () => {
    expect(() =>
      validateEnv({
        ...baseEnv,
        NODE_ENV: 'production',
        JWT_SECRET: 'prod-jwt-secret-key-for-testing-check',
        JWT_REFRESH_SECRET: 'test-refresh-secret-key-for-testing-only',
        BCRYPT_ROUNDS: '12',
      })
    ).toThrow(/生产环境禁止使用默认\/测试占位密钥/);
  });

  it('登录限流必须高于失败锁定阈值', () => {
    expect(() =>
      validateEnv({
        ...baseEnv,
        THROTTLE_LOGIN_LIMIT: '5',
      })
    ).toThrow(/THROTTLE_LOGIN_LIMIT 必须大于登录失败锁定阈值 5/);
  });

  it('官网留资可选配置允许空字符串占位', () => {
    const env = validateEnv({
      ...baseEnv,
      WEBSITE_LEAD_WEBHOOK_SECRET: '',
      WEBSITE_LEAD_DEFAULT_OWNER_EMPLOYEE_ID: '',
    });

    expect(env.WEBSITE_LEAD_WEBHOOK_SECRET).toBeUndefined();
    expect(env.WEBSITE_LEAD_DEFAULT_OWNER_EMPLOYEE_ID).toBeUndefined();
  });

  it('小红书同步默认关闭，启用时要求完整凭据', () => {
    expect(validateEnv(baseEnv).XIAOHONGSHU_SYNC_ENABLED).toBe(false);
    expect(() =>
      validateEnv({
        ...baseEnv,
        XIAOHONGSHU_SYNC_ENABLED: 'true',
      })
    ).toThrow(/启用小红书同步时必须配置/);
  });

  it('小红书同步接受 32 字节 base64 加密密钥', () => {
    const env = validateEnv({
      ...baseEnv,
      XIAOHONGSHU_SYNC_ENABLED: 'true',
      XIAOHONGSHU_APP_ID: '12597',
      XIAOHONGSHU_APP_SECRET: 'test-app-secret',
      XIAOHONGSHU_TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
    });

    expect(env.XIAOHONGSHU_SYNC_ENABLED).toBe(true);
    expect(env.XIAOHONGSHU_SYNC_LOOKBACK_DAYS).toBe(30);
  });

  it('SUPER_ADMIN_EMPLOYEE_ID 必须是 UUID，且生产环境缺失时启动失败', () => {
    expect(() =>
      validateEnv({
        ...baseEnv,
        SUPER_ADMIN_EMPLOYEE_ID: 'not-a-uuid',
      })
    ).toThrow(/SUPER_ADMIN_EMPLOYEE_ID 必须是员工稳定 UUID/);

    expect(() =>
      validateEnv({
        ...baseEnv,
        NODE_ENV: 'production',
        JWT_SECRET: 'prod-jwt-secret-key-for-validation',
        JWT_REFRESH_SECRET: 'prod-refresh-secret-key-for-validation',
        BCRYPT_ROUNDS: '12',
        AMAP_WEB_SERVICE_KEY: 'amap-web-service-key-for-test',
        PUBLIC_API_BASE_URL: 'http://localhost:3000',
      })
    ).toThrow(/生产环境必须配置受保护员工 UUID/);
  });

  it('生产环境必须配置公开 API 基础地址', () => {
    expect(() =>
      validateEnv({
        ...baseEnv,
        NODE_ENV: 'production',
        JWT_SECRET: 'prod-jwt-secret-key-for-validation',
        JWT_REFRESH_SECRET: 'prod-refresh-secret-key-for-validation',
        BCRYPT_ROUNDS: '12',
        AMAP_WEB_SERVICE_KEY: 'amap-web-service-key-for-test',
      })
    ).toThrow(/生产环境必须配置公开 API 基础地址/);
  });

  it('生产环境未配置高德 Key 时仍可启动，签到地址服务保持关闭', () => {
    expect(
      validateEnv({
        ...baseEnv,
        NODE_ENV: 'production',
        JWT_SECRET: 'prod-jwt-secret-key-for-validation',
        JWT_REFRESH_SECRET: 'prod-refresh-secret-key-for-validation',
        BCRYPT_ROUNDS: '12',
        PUBLIC_API_BASE_URL: 'http://localhost:3000',
        SUPER_ADMIN_EMPLOYEE_ID: superAdminEmployeeId,
      }).AMAP_WEB_SERVICE_KEY
    ).toBeUndefined();
  });
});
