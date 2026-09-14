import type { IAttachment } from '@ky-azeroth/shared/types/common';
import { EventEmitter } from 'events';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  buildVisitRecordMarkdown,
  pushVisitRecordToDingTalk,
  type VisitRecordNotifyAttachment,
  type VisitRecordNotifyPayload,
} from '../visit-record-notifier';

// Mock Node 内置 https 模块——真实网络 IO 在 CI 里不可用且不稳定
vi.mock('https', () => ({
  request: vi.fn(),
}));

async function importMockedHttps() {
  return (await import('https')) as unknown as { request: ReturnType<typeof vi.fn> };
}

interface MockOptions {
  responseBody?: string;
  statusCode?: number;
  emitError?: string;
  emitTimeout?: boolean;
}

/**
 * 构造一个 fake https.request，模拟 Node http/https 三种事件路径：
 * - 正常返回（response 'data' + 'end'）
 * - 触发 request error
 * - 触发 request timeout（走 req.destroy）
 */
function mockHttpsRequest(mockRequest: ReturnType<typeof vi.fn>, options: MockOptions = {}) {
  mockRequest.mockImplementation((_config, callback) => {
    const req = new EventEmitter() as EventEmitter & {
      end: (body?: string) => void;
      destroy: (err?: Error) => void;
    };
    req.end = () => {
      if (options.emitError) {
        setImmediate(() => req.emit('error', new Error(options.emitError!)));
        return;
      }
      if (options.emitTimeout) {
        setImmediate(() => req.emit('timeout'));
        return;
      }
      const res = new EventEmitter() as EventEmitter & { statusCode: number };
      res.statusCode = options.statusCode ?? 200;
      setImmediate(() => {
        callback(res);
        res.emit('data', Buffer.from(options.responseBody ?? '{"errcode":0,"errmsg":"ok"}'));
        res.emit('end');
      });
    };
    req.destroy = () => {
      /* no-op；push 逻辑里 destroy 后会走 error 分支，这里显式吞 */
    };
    return req;
  });
}

/**
 * 拜访钉钉推送模板 & 主入口测试。
 *
 * 网络 IO 不 mock（webhook 走真实 https 会失败），仅覆盖：
 * - markdown 模板对各种数据形态的正确渲染
 * - `pushVisitRecordToDingTalk` 在 webhook 未配置时的静默兜底
 */

const baseAttachmentImage = (
  id: string,
  url: string,
  previewUrl?: string
): VisitRecordNotifyAttachment => ({
  id,
  name: `${id}.jpg`,
  url,
  size: 12345,
  mimeType: 'image/jpeg',
  ...(previewUrl ? { previewUrl } : {}),
});

const baseAttachmentPdf = (id: string): IAttachment => ({
  id,
  name: `${id}.pdf`,
  url: `http://example.com/${id}.pdf`,
  size: 54321,
  mimeType: 'application/pdf',
});

const basePayload = (
  overrides: Partial<VisitRecordNotifyPayload> = {}
): VisitRecordNotifyPayload => ({
  id: 'r1',
  customerName: '示例食品有限公司',
  contactName: '林总',
  visitType: 'follow_up',
  content: '跟进上周报价，客户确认预算，本周内签合同',
  signInTime: new Date('2026-07-04T06:00:00.000Z'),
  signAddress: '示例省示例市示例区示例路1号',
  signLocation: '120.0000,30.0000',
  attachments: null,
  creatorName: '周销售',
  ...overrides,
});

describe('buildVisitRecordMarkdown', () => {
  it('title 格式为「XX拜访记录」，含提交人姓名 + 关键词「拜访」', () => {
    const { title } = buildVisitRecordMarkdown(basePayload());
    expect(title).toBe('周销售拜访记录');
    expect(title).toContain('拜访');
  });

  it('markdown text 首行为 emoji + title，含客户全称，不再有独立的提交人行', () => {
    const { text } = buildVisitRecordMarkdown(basePayload());
    expect(text).toContain('### 📍 周销售拜访记录');
    expect(text).toContain('客户：**示例食品有限公司**');
    expect(text).not.toContain('刚提交了一条拜访记录');
  });

  it('visitType 走 label 映射：follow_up → 跟进拜访', () => {
    const { text } = buildVisitRecordMarkdown(basePayload());
    expect(text).toContain('类型：跟进拜访');
  });

  it('未知 visitType 直接展示原值', () => {
    const { text } = buildVisitRecordMarkdown(basePayload({ visitType: 'custom_type' }));
    expect(text).toContain('类型：custom_type');
  });

  it('有 signLocation 时 位置字段渲染为高德地图跳转链接', () => {
    const { text } = buildVisitRecordMarkdown(basePayload());
    expect(text).toContain(
      '[示例省示例市示例区示例路1号](https://uri.amap.com/marker?position=120%2C30'
    );
  });

  it('signLocation 缺失时 位置字段退化为纯文本', () => {
    const { text } = buildVisitRecordMarkdown(basePayload({ signLocation: null }));
    expect(text).toContain('位置：示例省示例市示例区示例路1号');
    expect(text).not.toContain('uri.amap.com/marker');
  });

  it('signLocation 缺失但地址是「纬度/经度」坐标时，仍兜底渲染为高德地图链接', () => {
    const { text } = buildVisitRecordMarkdown(
      basePayload({
        signAddress: '纬度 30.000000, 经度 120.000000 (精度 50米)',
        signLocation: null,
      })
    );
    expect(text).toContain(
      '[纬度 30.000000, 经度 120.000000 (精度 50米)](https://uri.amap.com/marker?position=120%2C30'
    );
  });

  it('signLocation 缺失但地址尾部含「(纬度, 经度)」时，按高德 lng,lat 顺序生成链接', () => {
    const { text } = buildVisitRecordMarkdown(
      basePayload({
        signAddress: '示例省 示例市 示例区 (30.100000, 120.100000)',
        signLocation: null,
      })
    );
    expect(text).toContain(
      '[示例省 示例市 示例区 (30.100000, 120.100000)](https://uri.amap.com/marker?position=120.1%2C30.1'
    );
  });

  it('非法 signLocation 也退化为纯文本（防 XSS/URL 拼接爆炸）', () => {
    const { text } = buildVisitRecordMarkdown(basePayload({ signLocation: 'not-a-coord' }));
    expect(text).not.toContain('uri.amap.com/marker');
  });

  it('content 超过 80 字截断到 80 + 省略号', () => {
    const long = 'x'.repeat(200);
    const { text } = buildVisitRecordMarkdown(basePayload({ content: long }));
    expect(text).toMatch(/内容：x{80}…/);
  });

  it('空字段整行不出现（联系人/内容/位置/时间可任一为空）', () => {
    const { text } = buildVisitRecordMarkdown(
      basePayload({
        contactName: null,
        content: null,
        signAddress: null,
        signInTime: null,
      })
    );
    expect(text).not.toContain('联系人');
    expect(text).not.toContain('内容');
    expect(text).not.toContain('位置');
    expect(text).not.toContain('时间');
    // 客户名还在
    expect(text).toContain('客户：');
  });

  it('图片附件只展示数量，不泄露规范存储 URL', () => {
    const { text } = buildVisitRecordMarkdown(
      basePayload({
        attachments: [
          baseAttachmentImage('a', 'http://x/a.jpg'),
          baseAttachmentImage('b', 'http://x/b.jpg'),
          baseAttachmentImage('c', 'http://x/c.jpg'),
        ],
      })
    );
    expect(text).toContain('📸 照片：3 张（请在拜访记录中查看）');
    expect(text).not.toContain('http://x/');
  });

  it('图片附件最多展示 3 张短时预览，不泄露规范存储 URL', () => {
    const { text } = buildVisitRecordMarkdown(
      basePayload({
        attachments: [
          baseAttachmentImage('a', 'http://storage/a.jpg', 'https://api/preview/a'),
          baseAttachmentImage('b', 'http://storage/b.jpg', 'https://api/preview/b'),
          baseAttachmentImage('c', 'http://storage/c.jpg', 'https://api/preview/c'),
          baseAttachmentImage('d', 'http://storage/d.jpg', 'https://api/preview/d'),
          baseAttachmentImage('e', 'http://storage/e.jpg', 'https://api/preview/e'),
        ],
      })
    );
    expect(text).toContain('📸 照片（共 5 张，预览 3 张）：');
    expect(text).toContain('![](https://api/preview/a)');
    expect(text).toContain('![](https://api/preview/c)');
    expect(text).not.toContain('https://api/preview/d');
    expect(text).not.toContain('http://storage/');
  });

  it('混合附件：图片走图片渲染 + 其他附件走 📎 尾行', () => {
    const { text } = buildVisitRecordMarkdown(
      basePayload({
        attachments: [
          baseAttachmentImage('a', 'http://x/a.jpg'),
          baseAttachmentPdf('quote'),
          baseAttachmentPdf('contract'),
        ],
      })
    );
    expect(text).toContain('📸 照片：1 张（请在拜访记录中查看）');
    expect(text).toContain('📎 其他附件：quote.pdf、contract.pdf');
  });

  it('纯非图附件 4 个：📎 展示前 3 + 「等 4 个文件」', () => {
    const { text } = buildVisitRecordMarkdown(
      basePayload({
        attachments: [
          baseAttachmentPdf('a'),
          baseAttachmentPdf('b'),
          baseAttachmentPdf('c'),
          baseAttachmentPdf('d'),
        ],
      })
    );
    expect(text).toContain('📎 其他附件：a.pdf、b.pdf、c.pdf等 4 个文件');
    expect(text).not.toContain('📸');
  });

  it('无附件时 不出现 📸/📎 段', () => {
    const { text } = buildVisitRecordMarkdown(basePayload({ attachments: null }));
    expect(text).not.toContain('📸');
    expect(text).not.toContain('📎');
  });

  it('creatorName 缺失 fallback 到 "同事"，反映在 title 上', () => {
    const { title } = buildVisitRecordMarkdown(basePayload({ creatorName: null }));
    expect(title).toBe('同事拜访记录');
  });

  it('signInTime 字符串（ISO）固定按北京时间渲染为 MM-DD HH:mm', () => {
    const { text } = buildVisitRecordMarkdown(basePayload({ signInTime: '2026-07-04T06:00:00Z' }));
    expect(text).toContain('时间：07-04 14:00');
  });
});

describe('pushVisitRecordToDingTalk', () => {
  it('webhook 未配置时 warn 一次并静默返回，不抛异常', async () => {
    const logs: string[] = [];
    await expect(
      pushVisitRecordToDingTalk(basePayload(), {
        webhookUrl: undefined,
        logger: { warn: (m) => logs.push(m) },
      })
    ).resolves.toBeUndefined();
    expect(logs.some((l) => l.includes('visit_dingtalk_webhook_not_configured'))).toBe(true);
  });

  it('webhook 是占位值（非 https 开头）时也走静默兜底', async () => {
    const logs: string[] = [];
    await expect(
      pushVisitRecordToDingTalk(basePayload(), {
        webhookUrl: 'pending',
        logger: { warn: (m) => logs.push(m) },
      })
    ).resolves.toBeUndefined();
    expect(logs.some((l) => l.includes('visit_dingtalk_webhook_not_configured'))).toBe(true);
  });

  describe('真实 https POST 分支（mock https.request）', () => {
    afterEach(() => vi.clearAllMocks());

    it('webhook 有效 + 钉钉返回 200/errcode:0 → log visit_dingtalk_pushed', async () => {
      const https = await importMockedHttps();
      mockHttpsRequest(https.request, {
        statusCode: 200,
        responseBody: '{"errcode":0,"errmsg":"ok"}',
      });
      const logs: string[] = [];
      await pushVisitRecordToDingTalk(basePayload(), {
        webhookUrl: 'https://oapi.dingtalk.com/robot/send?access_token=test',
        logger: { log: (m) => logs.push(m) },
      });
      expect(logs.some((l) => l.includes('visit_dingtalk_pushed'))).toBe(true);
      expect(logs.some((l) => l.includes('"status":200'))).toBe(true);
      expect(https.request).toHaveBeenCalledOnce();
    });

    it('钉钉返回非 2xx → 记录失败而不是成功', async () => {
      const https = await importMockedHttps();
      mockHttpsRequest(https.request, {
        statusCode: 400,
        responseBody: '{"errcode":310000,"errmsg":"keywords not in content"}',
      });
      const logs: string[] = [];
      const errors: string[] = [];
      await pushVisitRecordToDingTalk(basePayload(), {
        webhookUrl: 'https://oapi.dingtalk.com/robot/send?access_token=test',
        logger: { log: (m) => logs.push(m), error: (m) => errors.push(m) },
      });
      expect(logs.some((l) => l.includes('visit_dingtalk_pushed'))).toBe(false);
      expect(errors.some((l) => l.includes('visit_dingtalk_push_failed'))).toBe(true);
      expect(errors.some((l) => l.includes('"status":400'))).toBe(true);
    });

    it('HTTP 200 但 errcode 非 0 → 记录失败而不是成功', async () => {
      const https = await importMockedHttps();
      mockHttpsRequest(https.request, {
        statusCode: 200,
        responseBody: '{"errcode":310000,"errmsg":"keywords not in content"}',
      });
      const logs: string[] = [];
      const errors: string[] = [];
      await pushVisitRecordToDingTalk(basePayload(), {
        webhookUrl: 'https://oapi.dingtalk.com/robot/send?access_token=test',
        logger: { log: (m) => logs.push(m), error: (m) => errors.push(m) },
      });
      expect(logs.some((l) => l.includes('visit_dingtalk_pushed'))).toBe(false);
      expect(errors.some((l) => l.includes('"errcode":310000'))).toBe(true);
    });

    it('request 抛错 → log visit_dingtalk_push_failed，主流程不 throw', async () => {
      const https = await importMockedHttps();
      mockHttpsRequest(https.request, { emitError: 'ECONNREFUSED' });
      const errors: string[] = [];
      await expect(
        pushVisitRecordToDingTalk(basePayload(), {
          webhookUrl: 'https://oapi.dingtalk.com/robot/send?access_token=test',
          logger: { error: (m) => errors.push(m) },
        })
      ).resolves.toBeUndefined();
      expect(errors.some((l) => l.includes('visit_dingtalk_push_failed'))).toBe(true);
      expect(errors.some((l) => l.includes('ECONNREFUSED'))).toBe(true);
    });

    it('logger 缺省时也不 throw（no-op logger 分支）', async () => {
      const https = await importMockedHttps();
      mockHttpsRequest(https.request, { statusCode: 200 });
      await expect(
        pushVisitRecordToDingTalk(basePayload(), {
          webhookUrl: 'https://oapi.dingtalk.com/robot/send?access_token=test',
        })
      ).resolves.toBeUndefined();
    });
  });
});
