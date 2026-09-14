import type { Request } from 'express';
import { describe, expect, it, vi } from 'vitest';

import { AuthController } from './auth.controller';
import type { AuthService } from './auth.service';
import type { CurrentUserType } from './decorators/current-user.decorator';

describe('AuthController', () => {
  it('重新认证透传当前用户、session、密码、客户端 IP 与 user-agent', async () => {
    const response = { accessToken: 'access-new', refreshToken: 'refresh-new' };
    const authService = { reauthenticate: vi.fn().mockResolvedValue(response) };
    const controller = new AuthController(authService as unknown as AuthService);
    const user: CurrentUserType = {
      id: 'employee-1',
      username: 'admin',
      roles: ['ADMIN'],
      sessionId: 'session-1',
    };
    const request = {
      headers: { 'x-forwarded-for': '203.0.113.8' },
      socket: { remoteAddress: '127.0.0.1' },
    } as unknown as Request;

    await expect(
      controller.reauthenticate(user, { password: 'Current@123' }, request, 'test-agent')
    ).resolves.toEqual(response);
    expect(authService.reauthenticate).toHaveBeenCalledWith(
      'employee-1',
      'session-1',
      'Current@123',
      '203.0.113.8',
      'test-agent'
    );
  });
});
