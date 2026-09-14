import axios from 'axios';
import { describe, expect, it, vi } from 'vitest';

import { DingtalkHttp, DingtalkRateLimitError } from './dingtalk-http';

describe('DingtalkHttp', () => {
  it('90002 重试耗尽后抛 typed error，不把错误响应当成功返回', async () => {
    vi.spyOn(axios, 'create').mockReturnValue({
      request: vi.fn().mockResolvedValue({
        data: {
          errcode: 90002,
          errmsg: '接口调用超过频率限制',
          request_id: 'req-rate-limit',
        },
      }),
    } as never);
    const http = new DingtalkHttp({
      baseUrl: 'https://api.dingtalk.com',
      timeout: 1,
      maxRetries: 0,
    });

    await expect(http.get('/v1.0/test')).rejects.toMatchObject({
      name: 'DingtalkRateLimitError',
      code: 90002,
      requestId: 'req-rate-limit',
    });
    await expect(http.get('/v1.0/test')).rejects.toBeInstanceOf(DingtalkRateLimitError);
  });
});
