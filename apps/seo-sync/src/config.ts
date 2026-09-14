import dotenv from 'dotenv';
import path from 'path';

// 加载 .env 文件（仅本地调试有效；FC 上由 s.yaml 注入环境变量）
dotenv.config({ path: path.resolve(__dirname, '../.env') });

export interface SeoSyncConfig {
  /** 数据库连接 */
  databaseUrl: string;

  /** Bing Webmaster Tools API Key */
  bingApiKey: string;
  /** Bing 监测的站点 URL（含协议，必须与 Bing 后台 GetUserSites 返回的 Url 精确匹配） */
  bingSiteUrl: string;
  /**
   * 是否允许"站点已验证但返回 0 条 query 数据"仍算成功。
   * 默认 false：新站灰度期可临时设 true，否则一旦 API 返回空就 throw 让 sync_runs.status=partial/failed。
   * 这是修复"连续 9 次 success counts.bing=0"的关键开关。
   */
  bingAllowEmptyResult: boolean;

  /** Microsoft Clarity Data Export API Token (JWT) */
  clarityApiToken: string;
  /** Clarity 项目 ID */
  clarityProjectId: string;
  /** Clarity 站点 URL（用于打 siteUrl 字段） */
  claritySiteUrl: string;
  /** Clarity 抓取近 N 天数据（API 限制 1-3） */
  clarityNumOfDays: number;

  /**
   * Google Service Account JSON（完整 key.json 内容，字符串形式）。
   * 空 = 未启用 Google Search Console 同步（跳过 Google 阶段，不报错）。
   */
  googleServiceAccountJson: string;
  /**
   * GSC property URL：
   *   - Domain property: `sc-domain:example.com`（本项目已用；一次覆盖 https/http/www/子域）
   *   - URL prefix: `https://www.example.com/`
   */
  googleSiteUrl: string;
  /** GSC 数据落库时用的 siteUrl 字段（与 Bing 同表可查） */
  googleStorageSiteUrl: string;
  /** GSC 抓取近 N 天数据（GSC 延迟 2-3 天，建议 3-7） */
  googleNumOfDays: number;
  /** 允许 GSC 返回空数组算成功（新 property 灰度期用） */
  googleAllowEmptyResult: boolean;
  /** Google API 出海代理；优先 SEO_GOOGLE_HTTPS_PROXY，回退 HTTPS_PROXY/https_proxy */
  googleHttpsProxy: string;

  /** HTTP 请求节流毫秒（防限流） */
  throttleMs: number;

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
 * - dryRun=true 时不强制 API key（用于本地 typecheck / boot 自检）。
 * - 否则 Bing key + Clarity token 必填。
 */
export function loadConfig(options: { dryRun?: boolean } = {}): SeoSyncConfig {
  const dryRun = options.dryRun ?? envBool('DRY_RUN', false);

  const databaseUrl = dryRun
    ? optionalEnv('DATABASE_URL', 'postgresql://dry-run/dry-run')
    : requireEnv('DATABASE_URL');

  const bingApiKey = dryRun ? optionalEnv('SEO_BING_API_KEY', '') : requireEnv('SEO_BING_API_KEY');

  const clarityApiToken = dryRun
    ? optionalEnv('SEO_CLARITY_API_TOKEN', '')
    : requireEnv('SEO_CLARITY_API_TOKEN');

  return {
    databaseUrl,
    bingApiKey,
    // 注意：必须与 Bing 后台 GetUserSites 返回的 Url 字段完全一致。
    // Bing 后台登记的是 `https://www.example.com/`（带尾斜杠），
    // 漏掉尾斜杠会导致 syncBing 在确权阶段直接 throw（精确字符串匹配）。
    bingSiteUrl: optionalEnv('SEO_BING_SITE_URL', ''),
    bingAllowEmptyResult: envBool('SEO_BING_ALLOW_EMPTY_RESULT', false),
    clarityApiToken,
    clarityProjectId: optionalEnv('SEO_CLARITY_PROJECT_ID', ''),
    claritySiteUrl: optionalEnv('SEO_CLARITY_SITE_URL', ''),
    clarityNumOfDays: Number(optionalEnv('SEO_CLARITY_NUM_OF_DAYS', '3')),
    googleServiceAccountJson: optionalEnv('SEO_GOOGLE_SERVICE_ACCOUNT_JSON', ''),
    googleSiteUrl: optionalEnv('SEO_GOOGLE_SITE_URL', ''),
    googleStorageSiteUrl: optionalEnv('SEO_GOOGLE_STORAGE_SITE_URL', ''),
    googleNumOfDays: Number(optionalEnv('SEO_GOOGLE_NUM_OF_DAYS', '7')),
    googleAllowEmptyResult: envBool('SEO_GOOGLE_ALLOW_EMPTY_RESULT', true),
    googleHttpsProxy: optionalEnv(
      'SEO_GOOGLE_HTTPS_PROXY',
      optionalEnv('HTTPS_PROXY', optionalEnv('https_proxy', ''))
    ),
    throttleMs: Number(optionalEnv('SEO_THROTTLE_MS', '300')),
    dryRun,
  };
}
