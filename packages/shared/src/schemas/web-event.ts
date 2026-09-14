import { z } from 'zod';

import { withColumn } from './column-meta';
import { COL_DATETIME } from './column-widths';
import { paginationSchema, stringOrStringArray } from './common';

/**
 * URL query 里布尔值的安全解析：
 * - `'true' / '1' / 'yes'` → true
 * - `'false' / '0' / 'no'` → false
 * - 其他 / 空 → undefined（让 service 兜底默认值）
 *
 * **不要用 `z.coerce.boolean()`**——它走 JS Boolean() 语义，任何非空字符串
 * （包括 'false'）都是 truthy，会导致 `?isBot=false` 反向生效为 true。
 */
const boolishQuery = z.preprocess((v) => {
  if (v === undefined || v === null || v === '') return undefined;
  if (typeof v === 'boolean') return v;
  if (typeof v === 'string') {
    const s = v.toLowerCase();
    if (s === 'true' || s === '1' || s === 'yes') return true;
    if (s === 'false' || s === '0' || s === 'no') return false;
  }
  return v;
}, z.boolean().optional());

/**
 * 官网第一方埋点事件——只读两件套（query + response）。
 *
 * 数据写入由独立 collector（独立 analytics collector）直连 PG，
 * 不通过 azeroth；azeroth 只提供查询 + 归档维护。
 *
 * 关键差异（与其他 azeroth 实体）：
 *   - 表在独立 schema `web_analytics`，通过 Prisma multiSchema 跨 schema 读
 *   - 主键 id 是 BIGINT IDENTITY（不是 UUID）——response 中转 string 序列化
 *   - 复合主键 (id, received_at)，因为 events 是月分区表（PIPL retention 合规）
 *   - 无 deletedAt 软删除字段：`received_at` 即时间戳
 */

/**
 * 埋点事件查询 Schema（只读实体，无 create/update）
 *
 * 注意：`isBot` 默认 false 由 service 层兜底，不在 schema 层 default
 *       （让 admin 显式传 `isBot=true` 可看 bot 流量诊断）。
 */
export const queryWebEventSchema = paginationSchema
  .extend({
    /** 起始时间（含），ISO 字符串或 yyyy-MM-dd；服务端按北京时间解析 */
    dateFrom: z.string().optional(),
    /** 结束时间（不含），ISO 字符串或 yyyy-MM-dd */
    dateTo: z.string().optional(),
    /** 事件名，单值或多值：pageview / consult_cta_click / consult_modal_open / ... */
    event: stringOrStringArray,
    /** 站点 host（如 example.com / www.example.com），跨域名迁移场景 */
    site: z.string().optional(),
    /** 路径精确匹配 */
    path: z.string().optional(),
    /** 路径前缀匹配（如 /blog/ 抓所有博客文章） */
    pathPrefix: z.string().optional(),
    /** 访客 ID 精确匹配 */
    vid: z.string().optional(),
    /** 会话 ID 精确匹配 */
    sid: z.string().optional(),
    /** UTM 来源 */
    utmSource: stringOrStringArray,
    /** UTM 媒介 */
    utmMedium: stringOrStringArray,
    /** UTM 活动 */
    utmCampaign: stringOrStringArray,
    /** 来源域名 */
    refHost: stringOrStringArray,
    /** 咨询位置（如 home_top / blog_inline） */
    placement: stringOrStringArray,
    /** 咨询渠道（如 phone / wechat_mp / dingtalk） */
    channel: stringOrStringArray,
    /** 是否包含 bot 流量；不传默认 service 兜底 false */
    isBot: boolishQuery,
    /** 跨 title/path 模糊搜 */
    keyword: z.string().max(100).optional(),
  })
  .refine((d) => !(d.path && d.pathPrefix), {
    message: 'path 与 pathPrefix 互斥，只能传其一',
    path: ['pathPrefix'],
  });

export type QueryWebEventInput = z.infer<typeof queryWebEventSchema>;

/**
 * 埋点事件响应 Schema
 *
 * id 是 BIGINT，Prisma 返回 BigInt 类型——service 层必须 `id: row.id.toString()`
 * 转字符串后再返回，否则 JSON 序列化会抛 `Do not know how to serialize a BigInt`。
 */
export const webEventResponseSchema = z.object({
  /** BIGINT 转字符串（避免 JSON BigInt 序列化问题） */
  id: z.string(),
  receivedAt: withColumn(z.string(), {
    label: '接收时间',
    width: COL_DATETIME,
    type: 'datetime',
    sortable: true,
    exportFormatterKey: 'datetime',
  }),
  clientTs: withColumn(z.string().optional().nullable(), {
    label: '客户端时间',
    width: COL_DATETIME,
    type: 'datetime',
    exportFormatterKey: 'datetime',
  }),
  site: withColumn(z.string(), {
    label: '站点',
    minWidth: 140,
    type: 'text',
  }),
  event: withColumn(z.string(), {
    label: '事件',
    minWidth: 180,
    type: 'text',
    required: true,
  }),
  vid: withColumn(z.string().optional().nullable(), {
    label: '访客 ID',
    minWidth: 140,
    type: 'text',
  }),
  sid: withColumn(z.string().optional().nullable(), {
    label: '会话 ID',
    minWidth: 140,
    type: 'text',
  }),
  path: withColumn(z.string().optional().nullable(), {
    label: '页面路径',
    minWidth: 200,
    type: 'text',
  }),
  pageType: withColumn(z.string().optional().nullable(), {
    label: '页面类型',
    minWidth: 100,
    type: 'text',
  }),
  title: withColumn(z.string().optional().nullable(), {
    label: '页面标题',
    minWidth: 200,
    type: 'text',
  }),
  referrer: withColumn(z.string().optional().nullable(), {
    label: '来源 URL',
    minWidth: 200,
    type: 'text',
  }),
  refHost: withColumn(z.string().optional().nullable(), {
    label: '来源域名',
    minWidth: 140,
    type: 'text',
  }),
  utmSource: withColumn(z.string().optional().nullable(), {
    label: 'UTM 来源',
    minWidth: 120,
    type: 'text',
  }),
  utmMedium: withColumn(z.string().optional().nullable(), {
    label: 'UTM 媒介',
    minWidth: 120,
    type: 'text',
  }),
  utmCampaign: withColumn(z.string().optional().nullable(), {
    label: 'UTM 活动',
    minWidth: 120,
    type: 'text',
  }),
  utmTerm: withColumn(z.string().optional().nullable(), {
    label: 'UTM 关键词',
    minWidth: 120,
    type: 'text',
  }),
  utmContent: withColumn(z.string().optional().nullable(), {
    label: 'UTM 内容',
    minWidth: 120,
    type: 'text',
  }),
  placement: withColumn(z.string().optional().nullable(), {
    label: '咨询位置',
    minWidth: 140,
    type: 'text',
  }),
  channel: withColumn(z.string().optional().nullable(), {
    label: '咨询渠道',
    minWidth: 140,
    type: 'text',
  }),
  label: withColumn(z.string().optional().nullable(), {
    label: '标签',
    minWidth: 120,
    type: 'text',
  }),
  ua: withColumn(z.string().optional().nullable(), {
    label: 'User-Agent',
    minWidth: 240,
    type: 'text',
  }),
  isBot: withColumn(z.boolean(), {
    label: 'Bot',
    width: 70,
    type: 'text',
  }),
  ipHash: withColumn(z.string().optional().nullable(), {
    label: 'IP Hash',
    minWidth: 140,
    type: 'text',
  }),
  /**
   * IP → 地域反查字段（collector 用 ip2region 中国本土库解析）。
   *
   * 明文 IP 坚决不下发（隐私红线，PIPL 19 类可识别个人信息范围），
   * 只暴露 country/region/city/isp 四个粒度：
   *   - country 常见值："中国" / "0"（未识别）
   *   - region 常见值："福建省" / "广东省" / "0"
   *   - city   常见值："泉州市" / "厦门市" / "0"
   *   - isp    常见值："电信" / "联通" / "移动" / "0"
   *
   * 城市级地域对个人识别贡献低 + 属合理商业分析用途（流量地域分布、
   * 转化率省份差异、异常访问溯源），无 PIPL 合规风险。
   */
  country: withColumn(z.string().optional().nullable(), {
    label: '国家',
    width: 80,
    type: 'text',
  }),
  region: withColumn(z.string().optional().nullable(), {
    label: '省份',
    minWidth: 100,
    type: 'text',
  }),
  city: withColumn(z.string().optional().nullable(), {
    label: '城市',
    minWidth: 100,
    type: 'text',
  }),
  isp: withColumn(z.string().optional().nullable(), {
    label: '运营商',
    width: 80,
    type: 'text',
  }),
  screen: withColumn(z.string().optional().nullable(), {
    label: '屏幕',
    minWidth: 100,
    type: 'text',
  }),
  lang: withColumn(z.string().optional().nullable(), {
    label: '语言',
    width: 80,
    type: 'text',
  }),
  /** 未建模字段（collector 收到的原始 payload 残留） */
  raw: z.record(z.unknown()).optional().nullable(),
});

export type WebEventResponseOutput = z.infer<typeof webEventResponseSchema>;

/**
 * 埋点归档（DML 维护，admin-only）
 *
 * 用途：清测试数据、按 PIPL retention 归档历史月份。
 * 走 azeroth CLI extras（`azeroth web-events archive ...`）；
 * 取代了原 wa_admin 直连 PG 的归档脚本。
 *
 * 默认 dryRun=true 只返影响行数；要真删必须显式传 dryRun=false + yes=true。
 */
export const archiveWebEventsSchema = z
  .object({
    /** 删除该时间（北京时间）之前的事件。ISO 字符串或 yyyy-MM-dd */
    before: z.string().min(1, 'before 必填'),
    /** 可选：仅删除指定 path 的事件（清测试用，如 `/__test__/`） */
    path: z.string().optional(),
    /** 默认 true：只返回影响行数，不真删 */
    dryRun: z.boolean().default(true),
    /** 真删时必须显式传 true，防误调 */
    yes: z.boolean().default(false),
  })
  .refine((data) => data.dryRun || data.yes, {
    message: '真删必须同时传 dryRun=false 与 yes=true',
    path: ['yes'],
  });

export type ArchiveWebEventsInput = z.infer<typeof archiveWebEventsSchema>;
