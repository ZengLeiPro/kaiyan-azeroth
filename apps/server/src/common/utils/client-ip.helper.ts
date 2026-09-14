/**
 * 客户端 IP 提取
 *
 * 背景：登录日志、操作日志等场景需要记录客户端真实 IP。
 * - 直接使用 `request.ip` 在反向代理（FC、Nginx）背后会拿到代理 IP。
 * - 配合 main.ts 的 `app.set('trust proxy', N)`（N 走 env `TRUST_PROXY_HOPS`，
 *   默认 1，覆盖 FC→容器一层），Express 会从 X-Forwarded-For 取真实 IP。
 * - **绝不传 `trust proxy = true`**：会让客户端任意伪造 XFF 链。
 *
 * 此 helper 吸收原本散落在 `jwt-auth.guard.ts` 与
 * `operation-log.interceptor.ts` 的两份重复逻辑，行为兼容两者：
 *   1. 优先读 X-Forwarded-For（取首段，处理逗号分隔）。
 *   2. 回退到 `request.ip`。
 *   3. 再回退到 `request.socket?.remoteAddress` 或
 *      `request.connection?.remoteAddress`（兼容旧 Node API）。
 *   4. 剥除 IPv4-mapped IPv6 前缀 `::ffff:`（FC/容器常返回 `::ffff:21.0.0.1`）。
 */
export interface ClientIpRequestShape {
  headers?: Record<string, string | string[] | undefined>;
  ip?: string;
  socket?: { remoteAddress?: string };
  connection?: { remoteAddress?: string };
}

const IPV4_MAPPED_PREFIX = '::ffff:';

function stripIpv4MappedPrefix(value: string): string {
  return value.startsWith(IPV4_MAPPED_PREFIX) ? value.slice(IPV4_MAPPED_PREFIX.length) : value;
}

/**
 * 从 Express Request 形状对象中提取客户端 IP。
 * 永远返回 string 或 undefined（无任何 throw）。
 */
export function extractClientIp(request: ClientIpRequestShape | undefined): string | undefined {
  if (!request) return undefined;

  const xff = request.headers?.['x-forwarded-for'];
  const xffStr = Array.isArray(xff) ? xff[0] : xff;
  if (typeof xffStr === 'string' && xffStr.length > 0) {
    const first = xffStr.split(',')[0];
    const trimmed = first ? first.trim() : '';
    if (trimmed.length > 0) return stripIpv4MappedPrefix(trimmed);
  }

  if (typeof request.ip === 'string' && request.ip.length > 0) {
    return stripIpv4MappedPrefix(request.ip);
  }

  const socketAddr = request.socket?.remoteAddress ?? request.connection?.remoteAddress;
  if (typeof socketAddr === 'string' && socketAddr.length > 0) {
    return stripIpv4MappedPrefix(socketAddr);
  }

  return undefined;
}
