/**
 * 官网第一方埋点事件（只读，由 collector 单边写入）
 *
 * 对应 Prisma model `WebEvent`（web_analytics.events 表）。collector 直连 PG
 * 写入，azeroth 只通过本类型 + Prisma client 做查询/归档。
 *
 * 字段名沿 Prisma model 的 camelCase（@map 到 snake_case 列）；id 在 API 边界
 * 转 string 序列化（BIGINT JSON 序列化兼容性）。
 *
 * 不提供 ICreate/IUpdate 类型——写入禁用（详见 schema.prisma 上的 model 注释）。
 */
export interface IWebEvent {
  /** BIGINT IDENTITY 全局唯一；service 层转 string 序列化 */
  id: string;
  /** 服务端接收时间（权威），ISO 字符串 */
  receivedAt: string;
  /** 客户端时间，仅诊断用 */
  clientTs?: string | null;
  /** 浏览器 location.host，支持域名迁移连续分析 */
  site: string;
  /** pageview / consult_cta_click / consult_modal_open / consult_channel_*_click / ... */
  event: string;
  /** 访客 ID（localStorage 生成） */
  vid?: string | null;
  /** 30 分钟滑动会话 ID（localStorage 生成） */
  sid?: string | null;
  /** pathname，不含 query */
  path?: string | null;
  /** 页面类型（home / blog_post / contact / ...） */
  pageType?: string | null;
  title?: string | null;
  /** 来源完整 URL */
  referrer?: string | null;
  /** 来源域名 */
  refHost?: string | null;
  utmSource?: string | null;
  utmMedium?: string | null;
  utmCampaign?: string | null;
  utmTerm?: string | null;
  utmContent?: string | null;
  /** 咨询位置（home_hero / blog_inline / ...） */
  placement?: string | null;
  /** 咨询渠道（phone / wechat_mp / dingtalk / ...） */
  channel?: string | null;
  label?: string | null;
  ua?: string | null;
  /** collector 基于 UA 的 bot 标记 */
  isBot: boolean;
  /** 加盐 IP hash，不能还原 IP */
  ipHash?: string | null;
  /**
   * IP → 地域反查（collector 用 ip2region 中国本土库解析，明文 IP 坚决不下发）。
   * 常见值："中国"/"0"（未识别）。
   */
  country?: string | null;
  /** 省份，常见值："福建省"/"广东省"/"0"（未识别）。 */
  region?: string | null;
  /** 城市，常见值："泉州市"/"厦门市"/"0"（未识别）。 */
  city?: string | null;
  /** 运营商，常见值："电信"/"联通"/"移动"/"0"（未识别）。 */
  isp?: string | null;
  screen?: string | null;
  lang?: string | null;
  /** 未建模字段（collector 收到的原始 payload 残留） */
  raw?: Record<string, unknown> | null;
}

/** API 响应类型（与实体同形，由 WebEventsService.toResponse 序列化产出） */
export interface IWebEventResponse extends IWebEvent {}
