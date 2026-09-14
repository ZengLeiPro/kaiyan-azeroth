/**
 * 拜访记录 → 钉钉「销售部」群自定义机器人推送
 *
 * 机制说明：钉钉自定义机器人 webhook 就是一条 HTTPS POST（无长连接、无 SDK）。
 * 我们用 Node 内置 `https` 发一次 POST 给 `oapi.dingtalk.com/robot/send?access_token=xxx`。
 * 群里的机器人安全策略配的是「自定义关键词」——消息 markdown title 里必须含「拜访」，
 * 否则钉钉服务端会静默拒收（errcode 310000）。本模块 title 硬编码「销售拜访新记录」保证命中。
 *
 * 触发点：`VisitRecordsService.create` 事务提交后（`refreshCustomerStatus` 之后），
 * 只有 `flowStatus==='approved'` 且 `yccrmId==null`（非同步数据）时才推送。
 * 推送异常 `.catch` 吞掉，不影响拜访主流程入库。
 *
 * 环境变量：`DINGTALK_SALES_VISIT_WEBHOOK`（生产 FC env）；未配置时 warn 一次跳过。
 */
import type { IAttachment } from '@ky-azeroth/shared/types/common';
import { request } from 'https';
import { URL } from 'url';

/** postJson 超时兜底（钉钉 P99 通常 < 500ms） */
const WEBHOOK_TIMEOUT_MS = 4000;

/** 拜访类型 label 就近映射（不引 shared/status-labels 避免服务端拉 web 常量循环） */
const VISIT_TYPE_LABEL: Record<string, string> = {
  first_visit: '初次拜访',
  follow_up: '跟进拜访',
  maintenance: '客情维护',
  delivery: '送货上门',
  other: '其他',
};

/**
 * 通知输入：从 Prisma `visitRecord.create` include customer/contact 后的行结构收敛。
 * 用宽松类型：service 侧传递部分反序列化对象，兼容 Date / string。
 */
export interface VisitRecordNotifyAttachment extends IAttachment {
  /** 仅供钉钉机器人立即拉取的短时签名预览地址，不持久化 */
  previewUrl?: string;
}

export interface VisitRecordNotifyPayload {
  id: string;
  customerName: string | null;
  contactName: string | null;
  visitType: string | null;
  content: string | null;
  signInTime: Date | string | null;
  signAddress: string | null;
  signLocation: string | null;
  attachments: VisitRecordNotifyAttachment[] | null;
  creatorName: string | null;
}

const SHANGHAI_DATETIME_FORMATTER = new Intl.DateTimeFormat('zh-CN', {
  timeZone: 'Asia/Shanghai',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

interface Coordinate {
  lng: number;
  lat: number;
}

function isValidCoordinate({ lng, lat }: Coordinate): boolean {
  return (
    Number.isFinite(lng) &&
    Number.isFinite(lat) &&
    lng >= -180 &&
    lng <= 180 &&
    lat >= -90 &&
    lat <= 90
  );
}

function coordinateToAmapPosition(coordinate: Coordinate): string | null {
  if (!isValidCoordinate(coordinate)) return null;
  return `${coordinate.lng},${coordinate.lat}`;
}

function parseLngLatText(value: string | null | undefined): Coordinate | null {
  if (!value) return null;
  const trimmed = value.replace(/\s+/g, '');
  const match = trimmed.match(/^([-+]?\d+(?:\.\d+)?),([-+]?\d+(?:\.\d+)?)$/);
  if (!match) return null;
  const coordinate = { lng: Number(match[1]), lat: Number(match[2]) };
  return isValidCoordinate(coordinate) ? coordinate : null;
}

function parseCoordinateFromAddress(signAddress: string | null | undefined): Coordinate | null {
  if (!signAddress) return null;

  const labeled = signAddress.match(
    /纬度\s*([-+]?\d+(?:\.\d+)?)\s*[,，]?\s*经度\s*([-+]?\d+(?:\.\d+)?)/u
  );
  if (labeled) {
    const coordinate = { lat: Number(labeled[1]), lng: Number(labeled[2]) };
    return isValidCoordinate(coordinate) ? coordinate : null;
  }

  const parenthesized = signAddress.match(
    /[（(]\s*([-+]?\d+(?:\.\d+)?)\s*[,，]\s*([-+]?\d+(?:\.\d+)?)\s*[）)]/u
  );
  if (!parenthesized) return null;

  const first = Number(parenthesized[1]);
  const second = Number(parenthesized[2]);
  const firstLooksLikeLng =
    Math.abs(first) > 90 && Math.abs(first) <= 180 && Math.abs(second) <= 90;
  const secondLooksLikeLng =
    Math.abs(second) > 90 && Math.abs(second) <= 180 && Math.abs(first) <= 90;

  const coordinate = firstLooksLikeLng
    ? { lng: first, lat: second }
    : secondLooksLikeLng
      ? { lng: second, lat: first }
      : null;

  return coordinate && isValidCoordinate(coordinate) ? coordinate : null;
}

/** 高德地图跨端跳转 URL（web/iOS App/Android App 三端通吃） */
function buildAmapUrl(
  signLocation: string | null,
  name: string | null,
  signAddress?: string | null
): string | null {
  const coordinate = parseLngLatText(signLocation) ?? parseCoordinateFromAddress(signAddress);
  const position = coordinate ? coordinateToAmapPosition(coordinate) : null;
  if (!position) return null;
  const params = new URLSearchParams({
    position,
    name: name || '签到位置',
    src: 'azeroth',
  });
  return `https://uri.amap.com/marker?${params.toString()}`;
}

/** 内容截断到 80 字符 + 省略号（钉钉手机端消息卡宽度有限） */
function truncateContent(content: string | null, limit = 80): string | null {
  if (!content) return null;
  const clean = content.replace(/\s+/g, ' ').trim();
  if (!clean) return null;
  return clean.length > limit ? `${clean.slice(0, limit)}…` : clean;
}

/** 格式化签到时间为 "MM-DD HH:mm"（钉钉群里默认理解为当年） */
function formatSignInTime(signInTime: Date | string | null): string | null {
  if (!signInTime) return null;
  const date = signInTime instanceof Date ? signInTime : new Date(signInTime);
  if (Number.isNaN(date.getTime())) return null;
  const parts = SHANGHAI_DATETIME_FORMATTER.formatToParts(date);
  const map: Record<string, string> = {};
  for (const part of parts) {
    map[part.type] = part.value;
  }
  if (!map.month || !map.day || !map.hour || !map.minute) return null;
  return `${map.month}-${map.day} ${map.hour}:${map.minute}`;
}

/** 从附件列表按 mimeType 拆分图片 / 其他 */
function splitAttachments(attachments: VisitRecordNotifyAttachment[] | null): {
  images: VisitRecordNotifyAttachment[];
  others: VisitRecordNotifyAttachment[];
} {
  if (!attachments || attachments.length === 0) return { images: [], others: [] };
  const images: VisitRecordNotifyAttachment[] = [];
  const others: VisitRecordNotifyAttachment[] = [];
  for (const att of attachments) {
    if (att.mimeType && att.mimeType.startsWith('image/')) {
      images.push(att);
    } else {
      others.push(att);
    }
  }
  return { images, others };
}

/**
 * 生成钉钉 markdown 文本。
 * 空字段整行不出现（避免"—"占屏噪音）。
 *
 * 图片最多展示 3 张短时签名预览；没有可用预览地址时退化为数量提示。
 * 规范 OSS URL 不进入群聊，其他附件仍只展示文件名。
 */
export function buildVisitRecordMarkdown(payload: VisitRecordNotifyPayload): {
  title: string;
  text: string;
} {
  const submitter = payload.creatorName || '同事';
  // 标题格式「XX拜访记录」——提交人姓名在前，天然含关键词「拜访」满足钉钉群校验
  const title = `${submitter}拜访记录`;
  const lines: string[] = [`### 📍 ${title}`, ''];

  if (payload.customerName) {
    lines.push(`- 客户：**${payload.customerName}**`);
  }
  if (payload.contactName) {
    lines.push(`- 联系人：${payload.contactName}`);
  }
  if (payload.visitType) {
    const label = VISIT_TYPE_LABEL[payload.visitType] || payload.visitType;
    lines.push(`- 类型：${label}`);
  }
  const timeText = formatSignInTime(payload.signInTime);
  if (timeText) {
    lines.push(`- 时间：${timeText}`);
  }
  if (payload.signAddress) {
    const amapUrl = buildAmapUrl(payload.signLocation, payload.customerName, payload.signAddress);
    if (amapUrl) {
      lines.push(`- 位置：[${payload.signAddress}](${amapUrl})`);
    } else {
      lines.push(`- 位置：${payload.signAddress}`);
    }
  }
  const content = truncateContent(payload.content);
  if (content) {
    lines.push(`- 内容：${content}`);
  }

  const { images, others } = splitAttachments(payload.attachments);
  if (images.length > 0) {
    const previewable = images.filter((image) => image.previewUrl).slice(0, 3);
    if (previewable.length > 0) {
      const omitted = images.length - previewable.length;
      const label =
        omitted > 0
          ? `📸 照片（共 ${images.length} 张，预览 ${previewable.length} 张）：`
          : `📸 照片（${images.length} 张）：`;
      lines.push('', label, '');
      for (const image of previewable) {
        lines.push(`![](${image.previewUrl})`);
      }
    } else {
      lines.push('', `📸 照片：${images.length} 张（请在拜访记录中查看）`);
    }
  }
  if (others.length > 0) {
    const shown = others.slice(0, 3).map((f) => f.name || '附件');
    const trailing = others.length > 3 ? `等 ${others.length} 个文件` : '';
    lines.push('', `📎 其他附件：${shown.join('、')}${trailing}`);
  }

  return { title, text: lines.join('\n') };
}

/** 内置 https POST，4s timeout（钉钉挂了也不能拖死拜访主流程） */
function postJson(
  urlText: string,
  data: unknown,
  timeoutMs = WEBHOOK_TIMEOUT_MS
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const url = new URL(urlText);
    const body = JSON.stringify(data);
    const req = request(
      {
        hostname: url.hostname,
        path: `${url.pathname}${url.search}`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
        },
        timeout: timeoutMs,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () =>
          resolve({
            status: res.statusCode ?? 0,
            body: Buffer.concat(chunks).toString('utf8'),
          })
        );
      }
    );
    req.on('timeout', () => {
      req.destroy(new Error('dingtalk_webhook_timeout'));
    });
    req.on('error', reject);
    req.end(body);
  });
}

/**
 * 主入口：发一条拜访记录到「销售部」群机器人。
 * 静默兜底：webhook 未配置或调用出错时 log 一次不抛，业务主流程无感。
 */
export async function pushVisitRecordToDingTalk(
  payload: VisitRecordNotifyPayload,
  options: {
    webhookUrl?: string;
    logger?: {
      log?: (msg: string) => void;
      warn?: (msg: string) => void;
      error?: (msg: string) => void;
    };
  } = {}
): Promise<void> {
  const webhook = options.webhookUrl?.trim();
  const log = options.logger?.log ?? (() => {});
  const warn = options.logger?.warn ?? (() => {});
  const error = options.logger?.error ?? (() => {});

  if (!webhook || !webhook.startsWith('https://')) {
    warn(
      JSON.stringify({
        level: 'warn',
        msg: 'visit_dingtalk_webhook_not_configured',
        recordId: payload.id,
      })
    );
    return;
  }

  const { title, text } = buildVisitRecordMarkdown(payload);
  try {
    const res = await postJson(webhook, {
      msgtype: 'markdown',
      markdown: { title, text },
      at: { isAtAll: false },
    });

    let responseData: { errcode?: number; errmsg?: string } | null = null;
    try {
      responseData = JSON.parse(res.body) as { errcode?: number; errmsg?: string };
    } catch {
      responseData = null;
    }

    if (res.status < 200 || res.status >= 300 || !responseData || responseData.errcode !== 0) {
      error(
        JSON.stringify({
          level: 'error',
          msg: 'visit_dingtalk_push_failed',
          recordId: payload.id,
          status: res.status,
          errcode: responseData?.errcode,
          errmsg: responseData?.errmsg,
          body: (res.body || '').slice(0, 200),
        })
      );
      return;
    }

    log(
      JSON.stringify({
        level: 'info',
        msg: 'visit_dingtalk_pushed',
        recordId: payload.id,
        status: res.status,
        body: (res.body || '').slice(0, 200),
      })
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    error(
      JSON.stringify({
        level: 'error',
        msg: 'visit_dingtalk_push_failed',
        recordId: payload.id,
        error: message,
      })
    );
  }
}
