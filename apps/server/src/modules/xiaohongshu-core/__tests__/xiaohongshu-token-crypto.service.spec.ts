import { ConfigService } from '@nestjs/config';
import { describe, expect, it } from 'vitest';

import {
  XiaohongshuTokenCryptoError,
  XiaohongshuTokenCryptoService,
} from '../xiaohongshu-token-crypto.service';

const KEY = Buffer.alloc(32, 7).toString('base64');

function createService(key?: string): XiaohongshuTokenCryptoService {
  return new XiaohongshuTokenCryptoService({
    get: () => key,
  } as unknown as ConfigService);
}

describe('XiaohongshuTokenCryptoService', () => {
  it('使用随机 IV 加密并可往返解密', () => {
    const service = createService(KEY);
    const first = service.encrypt('access-token');
    const second = service.encrypt('access-token');

    expect(first).not.toBe(second);
    expect(service.decrypt(first)).toBe('access-token');
    expect(service.decrypt(second)).toBe('access-token');
  });

  it('密文被篡改时拒绝解密', () => {
    const service = createService(KEY);
    const encrypted = service.encrypt('refresh-token');
    const parts = encrypted.split(':');
    const authTag = Buffer.from(parts[3]!, 'base64url');
    authTag[0] = authTag[0]! ^ 1;
    parts[3] = authTag.toString('base64url');

    expect(() => service.decrypt(parts.join(':'))).toThrow(XiaohongshuTokenCryptoError);
  });

  it('缺少或错误长度密钥时保持未配置且拒绝加密', () => {
    const service = createService(Buffer.alloc(16).toString('base64'));

    expect(service.isConfigured()).toBe(false);
    expect(() => service.encrypt('token')).toThrow(XiaohongshuTokenCryptoError);
  });

  it('错误密钥无法解密且错误信息不包含明文', () => {
    const encrypted = createService(KEY).encrypt('sensitive-token');
    const wrongKeyService = createService(Buffer.alloc(32, 9).toString('base64'));

    expect(() => wrongKeyService.decrypt(encrypted)).toThrow('Unable to decrypt Xiaohongshu token');
    try {
      wrongKeyService.decrypt(encrypted);
    } catch (error: unknown) {
      expect(String(error)).not.toContain('sensitive-token');
    }
  });
});
