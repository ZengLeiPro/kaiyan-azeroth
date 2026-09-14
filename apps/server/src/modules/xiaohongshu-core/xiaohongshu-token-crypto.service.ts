import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

const KEY_CONFIG_NAME = 'XIAOHONGSHU_TOKEN_ENCRYPTION_KEY';
const ALGORITHM = 'aes-256-gcm';
const VERSION_PREFIX = 'xhs-token:v1';
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

export class XiaohongshuTokenCryptoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'XiaohongshuTokenCryptoError';
  }
}

@Injectable()
export class XiaohongshuTokenCryptoService {
  private readonly encodedKey?: string;

  constructor(configService: ConfigService) {
    this.encodedKey = configService.get<string>(KEY_CONFIG_NAME);
  }

  isConfigured(): boolean {
    try {
      this.decodeKey(this.encodedKey);
      return true;
    } catch {
      return false;
    }
  }

  encrypt(plaintext: string): string {
    const key = this.decodeKey(this.encodedKey);
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv(ALGORITHM, key, iv, {
      authTagLength: AUTH_TAG_LENGTH,
    });
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();

    return [
      VERSION_PREFIX,
      iv.toString('base64url'),
      authTag.toString('base64url'),
      ciphertext.toString('base64url'),
    ].join(':');
  }

  decrypt(payload: string): string {
    try {
      const parts = payload.split(':');
      if (parts.length !== 5 || `${parts[0]}:${parts[1]}` !== VERSION_PREFIX) {
        throw new Error('Unsupported ciphertext format');
      }

      const key = this.decodeKey(this.encodedKey);
      const iv = this.decodeBase64Url(parts[2]!, IV_LENGTH);
      const authTag = this.decodeBase64Url(parts[3]!, AUTH_TAG_LENGTH);
      const ciphertext = this.decodeBase64Url(parts[4]!, undefined, true);
      const decipher = createDecipheriv(ALGORITHM, key, iv, {
        authTagLength: AUTH_TAG_LENGTH,
      });
      decipher.setAuthTag(authTag);
      return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
    } catch (error: unknown) {
      if (error instanceof XiaohongshuTokenCryptoError) throw error;
      throw new XiaohongshuTokenCryptoError('Unable to decrypt Xiaohongshu token');
    }
  }

  private decodeKey(encodedKey: string | undefined): Buffer {
    if (!encodedKey || encodedKey.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encodedKey)) {
      throw new XiaohongshuTokenCryptoError(
        `${KEY_CONFIG_NAME} must be valid base64 encoding exactly 32 bytes`
      );
    }

    const key = Buffer.from(encodedKey, 'base64');
    if (key.length !== 32) {
      throw new XiaohongshuTokenCryptoError(
        `${KEY_CONFIG_NAME} must be valid base64 encoding exactly 32 bytes`
      );
    }
    return key;
  }

  private decodeBase64Url(value: string, length?: number, allowEmpty = false): Buffer {
    if ((!allowEmpty && value.length === 0) || !/^[A-Za-z0-9_-]*$/.test(value)) {
      throw new Error('Invalid ciphertext component');
    }
    const decoded = Buffer.from(value, 'base64url');
    if (length !== undefined && decoded.length !== length) {
      throw new Error('Invalid ciphertext component length');
    }
    return decoded;
  }
}
