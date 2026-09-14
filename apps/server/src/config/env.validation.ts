import { z } from 'zod';

const DEFAULT_PLACEHOLDER_SECRETS = new Set([
  'secret',
  'jwt-secret',
  'your-secret-key',
  'test-secret',
  'test-jwt-secret-key-for-testing-only',
  'test-refresh-secret-key-for-testing-only',
]);

const durationSchema = z.string().regex(/^\d+[smhd]$/, '必须是形如 15m / 2h / 7d 的时长');
const optionalEnvString = (schema: z.ZodType<string>) =>
  z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
    schema.optional()
  );
const booleanEnv = z.preprocess(
  (value) => (typeof value === 'string' ? value.trim().toLowerCase() : value),
  z.union([z.boolean(), z.enum(['true', 'false']).transform((value) => value === 'true')])
);
const xiaohongshuEncryptionKeySchema = z.string().refine((value) => {
  if (value.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) return false;
  const key = Buffer.from(value, 'base64');
  return key.length === 32 && key.toString('base64') === value;
}, 'XIAOHONGSHU_TOKEN_ENCRYPTION_KEY 必须是 32 字节密钥的 base64 编码');
const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    DATABASE_URL: z.string().min(1, 'DATABASE_URL 不能为空'),
    JWT_SECRET: z.string().min(16, 'JWT_SECRET 至少 16 个字符'),
    JWT_REFRESH_SECRET: z.string().min(16, 'JWT_REFRESH_SECRET 至少 16 个字符'),
    JWT_ACCESS_EXPIRES_IN: durationSchema.default('2h'),
    JWT_REFRESH_EXPIRES_IN: durationSchema.default('7d'),
    CORS_ORIGIN: z.string().min(1, 'CORS_ORIGIN 不能为空').default('http://localhost:5173'),
    BCRYPT_ROUNDS: z.coerce.number().int().min(4).max(15).default(12),
    TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(10).default(1),
    API_PREFIX: z.string().min(1).default('api'),
    PUBLIC_API_BASE_URL: optionalEnvString(z.string().url()),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    THROTTLE_TTL: z.coerce.number().int().min(1).default(10),
    THROTTLE_LIMIT: z.coerce.number().int().min(1).default(1000),
    THROTTLE_LOGIN_LIMIT: z.coerce.number().int().min(1).default(10),
    THROTTLE_DINGTALK_LOGIN_LIMIT: z.coerce.number().int().min(1).default(20),
    THROTTLE_REFRESH_LIMIT: z.coerce.number().int().min(1).default(10),
    AMAP_WEB_SERVICE_KEY: optionalEnvString(z.string().min(16).max(128)),
    WEBSITE_LEAD_WEBHOOK_SECRET: optionalEnvString(z.string().min(16)),
    WEBSITE_LEAD_DEFAULT_OWNER_EMPLOYEE_ID: optionalEnvString(z.string().uuid()),
    SUPER_ADMIN_EMPLOYEE_ID: optionalEnvString(
      z.string().uuid('SUPER_ADMIN_EMPLOYEE_ID 必须是员工稳定 UUID')
    ),
    XIAOHONGSHU_APP_ID: optionalEnvString(z.string().regex(/^\d+$/, '必须是数字应用 ID')),
    XIAOHONGSHU_APP_SECRET: optionalEnvString(z.string().min(8)),
    XIAOHONGSHU_TOKEN_ENCRYPTION_KEY: optionalEnvString(xiaohongshuEncryptionKeySchema),
    XIAOHONGSHU_API_BASE_URL: optionalEnvString(z.string().url()),
    XIAOHONGSHU_SYNC_ENABLED: booleanEnv.default(false),
    XIAOHONGSHU_SYNC_LOOKBACK_DAYS: z.coerce.number().int().min(1).max(30).default(30),
  })
  .superRefine((env, ctx) => {
    if (env.JWT_SECRET === env.JWT_REFRESH_SECRET) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['JWT_REFRESH_SECRET'],
        message: 'JWT_REFRESH_SECRET 必须与 JWT_SECRET 相互独立',
      });
    }

    if (env.THROTTLE_LOGIN_LIMIT <= 5) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['THROTTLE_LOGIN_LIMIT'],
        message: 'THROTTLE_LOGIN_LIMIT 必须大于登录失败锁定阈值 5',
      });
    }

    if (env.XIAOHONGSHU_SYNC_ENABLED) {
      for (const key of [
        'XIAOHONGSHU_APP_ID',
        'XIAOHONGSHU_APP_SECRET',
        'XIAOHONGSHU_TOKEN_ENCRYPTION_KEY',
      ] as const) {
        if (!env[key]) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [key],
            message: '启用小红书同步时必须配置',
          });
        }
      }
    }

    if (env.NODE_ENV === 'production') {
      if (env.BCRYPT_ROUNDS < 12) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['BCRYPT_ROUNDS'],
          message: '生产环境 BCRYPT_ROUNDS 必须至少为 12',
        });
      }
      if (env.CORS_ORIGIN.trim() === '*') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['CORS_ORIGIN'],
          message: '生产环境禁止 CORS_ORIGIN=*',
        });
      }
      for (const key of ['JWT_SECRET', 'JWT_REFRESH_SECRET'] as const) {
        if (DEFAULT_PLACEHOLDER_SECRETS.has(env[key])) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [key],
            message: '生产环境禁止使用默认/测试占位密钥',
          });
        }
      }
      if (!env.PUBLIC_API_BASE_URL) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['PUBLIC_API_BASE_URL'],
          message: '生产环境必须配置公开 API 基础地址',
        });
      }
      if (!env.SUPER_ADMIN_EMPLOYEE_ID) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['SUPER_ADMIN_EMPLOYEE_ID'],
          message: '生产环境必须配置受保护员工 UUID',
        });
      }
    }
  });

export type ValidatedEnv = z.infer<typeof envSchema>;

export function validateEnv(config: Record<string, unknown>): ValidatedEnv {
  const parsed = envSchema.safeParse(config);
  if (!parsed.success) {
    const message = parsed.error.issues
      .map((issue) => `${issue.path.join('.') || 'ENV'}: ${issue.message}`)
      .join('; ');
    throw new Error(`环境变量校验失败: ${message}`);
  }
  return parsed.data;
}
