import dotenv from 'dotenv';
import path from 'path';

// 加载 .env 文件（仅本地调试有效；FC 上由 s.yaml 注入环境变量）
dotenv.config({ path: path.resolve(__dirname, '../.env') });

export interface CloudCostSyncConfig {
  /** 数据库连接 */
  databaseUrl: string;

  /** 阿里云访问凭据 */
  aliyunAccessKeyId: string;
  aliyunAccessKeySecret: string;

  /** 主账号 UID（多账号扩展用，可选） */
  aliyunAccountUid: string | null;

  /** BSS endpoint（全局） */
  bssEndpoint: string;
  /** CMS endpoint（分区域） */
  cmsEndpoint: string;

  /** BSS 调用间隔毫秒（防 10 QPS 限流） */
  bssThrottleMs: number;
  /** CMS 单页数据点数 */
  cmsPageSize: number;
  /** 用量回溯天数 */
  usageLookbackDays: number;

  /** dry-run：跳过外部写入 */
  dryRun: boolean;
}

function requireEnv(key: string): string {
  const v = process.env[key];
  if (!v) {
    throw new Error(`缺少必需的环境变量: ${key}`);
  }
  return v;
}

function optionalEnv(key: string, defaultValue: string): string {
  return process.env[key] || defaultValue;
}

function envBool(key: string, defaultValue: boolean): boolean {
  const v = process.env[key];
  if (!v) return defaultValue;
  return v.toLowerCase() !== 'false' && v !== '0';
}

/**
 * 加载配置。
 *
 * - dryRun=true 时不强制 AK/SK（用于本地 typecheck / boot 自检）。
 * - 否则 AK/SK 必填。
 */
export function loadConfig(options: { dryRun?: boolean } = {}): CloudCostSyncConfig {
  const dryRun = options.dryRun ?? envBool('DRY_RUN', false);

  const databaseUrl = dryRun
    ? optionalEnv('DATABASE_URL', 'postgresql://dry-run/dry-run')
    : requireEnv('DATABASE_URL');

  const aliyunAccessKeyId = dryRun
    ? optionalEnv('ALIYUN_ACCESS_KEY_ID', '')
    : requireEnv('ALIYUN_ACCESS_KEY_ID');
  const aliyunAccessKeySecret = dryRun
    ? optionalEnv('ALIYUN_ACCESS_KEY_SECRET', '')
    : requireEnv('ALIYUN_ACCESS_KEY_SECRET');

  return {
    databaseUrl,
    aliyunAccessKeyId,
    aliyunAccessKeySecret,
    aliyunAccountUid: process.env.ALIYUN_ACCOUNT_UID || null,
    bssEndpoint: optionalEnv('ALIYUN_BSS_ENDPOINT', 'business.aliyuncs.com'),
    cmsEndpoint: optionalEnv('ALIYUN_CMS_ENDPOINT', 'metrics.cn-hangzhou.aliyuncs.com'),
    bssThrottleMs: Number(optionalEnv('ALIYUN_BSS_THROTTLE_MS', '150')),
    cmsPageSize: Number(optionalEnv('ALIYUN_CMS_PAGE_SIZE', '2000')),
    usageLookbackDays: Number(optionalEnv('CLOUD_USAGE_LOOKBACK_DAYS', '7')),
    dryRun,
  };
}
