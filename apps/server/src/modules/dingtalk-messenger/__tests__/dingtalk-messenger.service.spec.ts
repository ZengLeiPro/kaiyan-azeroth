import { ConfigService } from '@nestjs/config';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DingtalkAuth } from '../../dingtalk-core/dingtalk-auth.service';
// 拦截内部 new DingtalkHttp 的 post：用 spy 替代 prototype.post
import { DingtalkHttp } from '../../dingtalk-core/dingtalk-http';
import { DingtalkMessengerService } from '../dingtalk-messenger.service';

function makeConfig(overrides: Record<string, string> = {}): ConfigService {
  return {
    get: vi.fn((key: string) => overrides[key] ?? undefined),
  } as unknown as ConfigService;
}

function makeAuth(token = 'token-AAA'): DingtalkAuth & {
  invalidate: ReturnType<typeof vi.fn>;
  getAccessToken: ReturnType<typeof vi.fn>;
} {
  return {
    getAccessToken: vi.fn().mockResolvedValue(token),
    invalidate: vi.fn(),
  } as unknown as DingtalkAuth & {
    invalidate: ReturnType<typeof vi.fn>;
    getAccessToken: ReturnType<typeof vi.fn>;
  };
}

describe('DingtalkMessengerService', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('agentId startup 校验', () => {
    it('agentId 非数字时 constructor 抛错（fail fast）', () => {
      const config = makeConfig({ DINGTALK_AGENT_ID: 'not-a-number' });
      expect(() => new DingtalkMessengerService(config, makeAuth())).toThrow(
        /DINGTALK_AGENT_ID 必须是正整数/
      );
    });

    it('agentId 为 0 / 负数时抛错', () => {
      expect(
        () => new DingtalkMessengerService(makeConfig({ DINGTALK_AGENT_ID: '0' }), makeAuth())
      ).toThrow();
      expect(
        () => new DingtalkMessengerService(makeConfig({ DINGTALK_AGENT_ID: '-1' }), makeAuth())
      ).toThrow();
    });

    it('agentId 为空时仅 warn 不抛（本地友好）', () => {
      const config = makeConfig({ DINGTALK_AGENT_ID: '' });
      expect(() => new DingtalkMessengerService(config, makeAuth())).not.toThrow();
    });

    it('agentId 合法时正常实例化', () => {
      const config = makeConfig({ DINGTALK_AGENT_ID: '3999943457' });
      expect(() => new DingtalkMessengerService(config, makeAuth())).not.toThrow();
    });
  });

  describe('sendActionCardToUsers', () => {
    const validConfig = () => makeConfig({ DINGTALK_AGENT_ID: '3999943457' });
    const params = {
      dingtalkUserIds: ['u1', 'u2'],
      title: '【待审批】合同订单审批',
      markdown: '**发起人**：张三',
      singleTitle: '查看审批详情',
      singleUrl: 'http://localhost:5173/approval/list?tab=pending&instanceId=inst-1',
    };

    it('userid_list 为空时静默 no-op，不调用 http', async () => {
      const auth = makeAuth();
      const svc = new DingtalkMessengerService(validConfig(), auth);
      const httpSpy = vi.spyOn(DingtalkHttp.prototype, 'post');
      await svc.sendActionCardToUsers({ ...params, dingtalkUserIds: [] });
      expect(httpSpy).not.toHaveBeenCalled();
      expect(auth.getAccessToken).not.toHaveBeenCalled();
    });

    it('agentId 未配置时跳过 + warn，不调用 http', async () => {
      const auth = makeAuth();
      const svc = new DingtalkMessengerService(makeConfig({ DINGTALK_AGENT_ID: '' }), auth);
      const httpSpy = vi.spyOn(DingtalkHttp.prototype, 'post');
      await svc.sendActionCardToUsers(params);
      expect(httpSpy).not.toHaveBeenCalled();
    });

    it('正常路径：调用 http.post，errcode=0 不重试', async () => {
      const auth = makeAuth();
      const svc = new DingtalkMessengerService(validConfig(), auth);
      const httpSpy = vi
        .spyOn(DingtalkHttp.prototype, 'post')
        .mockResolvedValue({ errcode: 0, task_id: 12345, request_id: 'req-1' });

      await svc.sendActionCardToUsers(params);

      expect(httpSpy).toHaveBeenCalledTimes(1);
      const [url, body, opts] = httpSpy.mock.calls[0]!;
      expect(url).toBe('/topapi/message/corpconversation/asyncsend_v2');
      expect((body as { agent_id: number }).agent_id).toBe(3999943457);
      expect((body as { userid_list: string }).userid_list).toBe('u1,u2');
      expect((opts as { params: { access_token: string } }).params.access_token).toBe('token-AAA');
      expect(auth.invalidate).not.toHaveBeenCalled();
    });

    it('errcode=88 且 subCode 明确 token 失效 → invalidate + 重试一次', async () => {
      const auth = makeAuth();
      const svc = new DingtalkMessengerService(validConfig(), auth);
      const httpSpy = vi
        .spyOn(DingtalkHttp.prototype, 'post')
        .mockResolvedValueOnce({
          errcode: 88,
          errmsg: '鉴权异常',
          subCode: 'InvalidAccessToken',
          subMsg: 'access token invalid',
        })
        .mockResolvedValueOnce({ errcode: 0, task_id: 999 });

      await svc.sendActionCardToUsers(params);

      expect(httpSpy).toHaveBeenCalledTimes(2);
      expect(auth.invalidate).toHaveBeenCalledTimes(1);
      // 第二次仍使用同样的 token（mock 不变，但走完整链路）
      expect(auth.getAccessToken).toHaveBeenCalledTimes(2);
    });

    it('errcode=88 但没有 token 诊断信息时不擅自 invalidate', async () => {
      const auth = makeAuth();
      const svc = new DingtalkMessengerService(validConfig(), auth);
      const httpSpy = vi
        .spyOn(DingtalkHttp.prototype, 'post')
        .mockResolvedValue({ errcode: 88, errmsg: '鉴权异常', subCode: 'UnknownAuthError' });

      await svc.sendActionCardToUsers(params);

      expect(httpSpy).toHaveBeenCalledTimes(1);
      expect(auth.invalidate).not.toHaveBeenCalled();
      expect(auth.getAccessToken).toHaveBeenCalledTimes(1);
    });

    it('errcode 其他错误（60011 无权限）不触发重试', async () => {
      const auth = makeAuth();
      const svc = new DingtalkMessengerService(validConfig(), auth);
      const httpSpy = vi
        .spyOn(DingtalkHttp.prototype, 'post')
        .mockResolvedValue({ errcode: 60011, errmsg: 'no permission' });

      await svc.sendActionCardToUsers(params);

      expect(httpSpy).toHaveBeenCalledTimes(1);
      expect(auth.invalidate).not.toHaveBeenCalled();
    });

    it('http 抛异常不影响调用方（不抛出）', async () => {
      const auth = makeAuth();
      const svc = new DingtalkMessengerService(validConfig(), auth);
      vi.spyOn(DingtalkHttp.prototype, 'post').mockRejectedValue(new Error('ECONNRESET'));

      await expect(svc.sendActionCardToUsers(params)).resolves.toBe(false);
    });

    it('markdown 超过 2000 字时被截断', async () => {
      const auth = makeAuth();
      const svc = new DingtalkMessengerService(validConfig(), auth);
      const httpSpy = vi
        .spyOn(DingtalkHttp.prototype, 'post')
        .mockResolvedValue({ errcode: 0, task_id: 1 });

      const longMd = 'X'.repeat(5000);
      await svc.sendActionCardToUsers({ ...params, markdown: longMd });

      const body = httpSpy.mock.calls[0]![1] as {
        msg: { action_card: { markdown: string } };
      };
      const actualMd = body.msg.action_card.markdown;
      expect(actualMd.length).toBeLessThanOrEqual(2000);
      expect(actualMd.endsWith('…')).toBe(true);
    });

    it('userId 超过 100 时分批发送', async () => {
      const auth = makeAuth();
      const svc = new DingtalkMessengerService(validConfig(), auth);
      const httpSpy = vi
        .spyOn(DingtalkHttp.prototype, 'post')
        .mockResolvedValue({ errcode: 0, task_id: 1 });

      const userIds = Array.from({ length: 250 }, (_, i) => `u${i}`);
      await svc.sendActionCardToUsers({ ...params, dingtalkUserIds: userIds });

      expect(httpSpy).toHaveBeenCalledTimes(3); // 100 + 100 + 50
    });
  });
});
