import { BadRequestException } from '@nestjs/common';

import { IS_PUBLIC_KEY } from '../../auth/decorators/public.decorator';
import type { XiaohongshuOauthService } from '../../xiaohongshu/xiaohongshu-oauth.service';
import { XiaohongshuOauthController } from '../xiaohongshu-oauth.controller';

describe('XiaohongshuOauthController', () => {
  const oauth = {
    handleCallback: vi.fn().mockResolvedValue({
      status: 'connected',
      message: 'connected',
      connectionId: 'connection-1',
      advertiserCount: 1,
    }),
    createAuthorizationUrl: vi.fn(),
  } as unknown as XiaohongshuOauthService;
  const controller = new XiaohongshuOauthController(oauth);

  it('仅 callback 方法公开', () => {
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, XiaohongshuOauthController)).toBeUndefined();
    const descriptor = Object.getOwnPropertyDescriptor(
      XiaohongshuOauthController.prototype,
      'callback'
    );
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, descriptor?.value)).toBe(true);
  });

  it('转发当前用户生成授权地址', async () => {
    vi.mocked(oauth.createAuthorizationUrl).mockResolvedValueOnce({
      authorizationUrl: 'https://example.com/auth',
      expiresAt: '2026-08-21T13:00:00.000Z',
    });

    await expect(controller.createAuthorizationUrl({ id: 'employee-1' } as never)).resolves.toEqual(
      {
        authorizationUrl: 'https://example.com/auth',
        expiresAt: '2026-08-21T13:00:00.000Z',
      }
    );
    expect(oauth.createAuthorizationUrl).toHaveBeenCalledWith('employee-1');
  });

  it('无参数 callback 返回就绪状态且不依赖配置', () => {
    expect(controller.callback({})).toEqual({
      status: 'ready',
      message: '小红书 OAuth 回调地址已就绪',
    });
  });

  it('auth_code 与 state 必须同时出现', () => {
    expect(() => controller.callback({ auth_code: 'code' })).toThrow(BadRequestException);
  });

  it('callback 响应不泄露授权码', async () => {
    const response = await controller.callback({ auth_code: 'secret-auth-code', state: 'state' });
    expect(JSON.stringify(response)).not.toContain('secret-auth-code');
    expect(oauth.handleCallback).toHaveBeenCalledWith('secret-auth-code', 'state');
  });
});
