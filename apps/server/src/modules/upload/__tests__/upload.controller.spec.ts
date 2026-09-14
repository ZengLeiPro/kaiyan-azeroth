import { BadRequestException } from '@nestjs/common';
import { EventEmitter } from 'events';
import { describe, expect, it, vi } from 'vitest';

import { IS_PUBLIC_KEY } from '../../auth/decorators/public.decorator';
import { UploadController, uploadFileFilter } from '../upload.controller';

/**
 * P0 fix §4.4: 验证 uploadFileFilter 的白名单 / 拒绝清单 / MIME 双重校验逻辑。
 * 通过避免 e2e 的方式直接断言 fileFilter 行为，运行成本接近 0。
 */
describe('uploadFileFilter (P0 §4.4 XSS allowlist)', () => {
  const captureCallback = () => {
    const calls: Array<{ err: Error | null; ok: boolean }> = [];
    const cb = (err: Error | null, ok: boolean) => {
      calls.push({ err, ok });
    };
    return { cb, calls };
  };

  describe('合法文件', () => {
    it('accepts png with image/png mime', () => {
      const { cb, calls } = captureCallback();
      uploadFileFilter({}, { originalname: 'avatar.png', mimetype: 'image/png' }, cb);
      expect(calls[0]?.err).toBeNull();
      expect(calls[0]?.ok).toBe(true);
    });

    it('accepts xlsx with correct mime', () => {
      const { cb, calls } = captureCallback();
      uploadFileFilter(
        {},
        {
          originalname: 'payroll.xlsx',
          mimetype: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        },
        cb
      );
      expect(calls[0]?.err).toBeNull();
      expect(calls[0]?.ok).toBe(true);
    });

    it('accepts pdf', () => {
      const { cb, calls } = captureCallback();
      uploadFileFilter({}, { originalname: 'contract.pdf', mimetype: 'application/pdf' }, cb);
      expect(calls[0]?.err).toBeNull();
      expect(calls[0]?.ok).toBe(true);
    });

    it('accepts csv', () => {
      const { cb, calls } = captureCallback();
      uploadFileFilter({}, { originalname: 'data.csv', mimetype: 'text/csv' }, cb);
      expect(calls[0]?.err).toBeNull();
      expect(calls[0]?.ok).toBe(true);
    });

    it('handles uppercase extension', () => {
      const { cb, calls } = captureCallback();
      uploadFileFilter({}, { originalname: 'PHOTO.JPG', mimetype: 'image/jpeg' }, cb);
      expect(calls[0]?.err).toBeNull();
      expect(calls[0]?.ok).toBe(true);
    });
  });

  describe('拒绝清单（XSS / 可执行）', () => {
    it('rejects .html even when mimetype claims image/png (defense in depth)', () => {
      const { cb, calls } = captureCallback();
      uploadFileFilter({}, { originalname: 'evil.html', mimetype: 'image/png' }, cb);
      expect(calls[0]?.err).toBeInstanceOf(BadRequestException);
      expect(calls[0]?.ok).toBe(false);
      expect((calls[0]?.err as BadRequestException).message).toContain('禁止上传');
    });

    it('rejects .htm', () => {
      const { cb, calls } = captureCallback();
      uploadFileFilter({}, { originalname: 'page.htm', mimetype: 'text/plain' }, cb);
      expect(calls[0]?.err).toBeInstanceOf(BadRequestException);
    });

    it('rejects .svg (script can run inside SVG)', () => {
      const { cb, calls } = captureCallback();
      uploadFileFilter({}, { originalname: 'icon.svg', mimetype: 'image/svg+xml' }, cb);
      expect(calls[0]?.err).toBeInstanceOf(BadRequestException);
    });

    it('rejects .js', () => {
      const { cb, calls } = captureCallback();
      uploadFileFilter({}, { originalname: 'payload.js', mimetype: 'application/javascript' }, cb);
      expect(calls[0]?.err).toBeInstanceOf(BadRequestException);
    });

    it('rejects .exe', () => {
      const { cb, calls } = captureCallback();
      uploadFileFilter(
        {},
        { originalname: 'malware.exe', mimetype: 'application/octet-stream' },
        cb
      );
      expect(calls[0]?.err).toBeInstanceOf(BadRequestException);
    });

    it('rejects .sh', () => {
      const { cb, calls } = captureCallback();
      uploadFileFilter({}, { originalname: 'attack.sh', mimetype: 'text/plain' }, cb);
      expect(calls[0]?.err).toBeInstanceOf(BadRequestException);
    });
  });

  describe('扩展名不在白名单', () => {
    it('rejects .mp4', () => {
      const { cb, calls } = captureCallback();
      uploadFileFilter({}, { originalname: 'movie.mp4', mimetype: 'video/mp4' }, cb);
      expect(calls[0]?.err).toBeInstanceOf(BadRequestException);
      expect((calls[0]?.err as BadRequestException).message).toContain('不支持的文件扩展名');
    });

    it('rejects file without extension', () => {
      const { cb, calls } = captureCallback();
      uploadFileFilter({}, { originalname: 'noext', mimetype: 'application/octet-stream' }, cb);
      expect(calls[0]?.err).toBeInstanceOf(BadRequestException);
    });
  });

  describe('MIME 不匹配（防伪造）', () => {
    it('rejects .png with application/javascript mime', () => {
      const { cb, calls } = captureCallback();
      uploadFileFilter({}, { originalname: 'pic.png', mimetype: 'application/javascript' }, cb);
      expect(calls[0]?.err).toBeInstanceOf(BadRequestException);
      expect((calls[0]?.err as BadRequestException).message).toContain('不支持的 MIME 类型');
    });

    it('rejects .pdf with text/html mime', () => {
      const { cb, calls } = captureCallback();
      uploadFileFilter({}, { originalname: 'doc.pdf', mimetype: 'text/html' }, cb);
      expect(calls[0]?.err).toBeInstanceOf(BadRequestException);
    });
  });
});

describe('UploadController signed image preview', () => {
  it('公开端点的缓存时间不超过令牌剩余有效期，并监听读取流错误', async () => {
    const stream = new EventEmitter() as EventEmitter & { pipe: ReturnType<typeof vi.fn> };
    stream.pipe = vi.fn();
    const now = Math.floor(Date.now() / 1000);
    const uploadService = {
      getImagePreviewStreamByToken: vi.fn().mockResolvedValue({
        stream,
        storageKey: '20260804/photo.jpg',
        mimeType: 'image/jpeg',
        expiresAt: now + 120,
      }),
    };
    const controller = new UploadController(uploadService as never, { log: vi.fn() } as never);
    const response = {
      set: vi.fn(),
      headersSent: false,
      destroy: vi.fn(),
      status: vi.fn().mockReturnThis(),
      end: vi.fn(),
    };

    await controller.previewImage('signed-token', response as never);

    expect(Reflect.getMetadata(IS_PUBLIC_KEY, UploadController.prototype.previewImage)).toBe(true);
    expect(response.set).toHaveBeenCalledWith(
      expect.objectContaining({
        'Content-Type': 'image/jpeg',
        'Cross-Origin-Resource-Policy': 'cross-origin',
        'Cache-Control': expect.stringMatching(/^public, max-age=12\d, immutable$/),
      })
    );
    expect(stream.pipe).toHaveBeenCalledWith(response);

    stream.emit('error', new Error('OSS read failed'));
    expect(response.status).toHaveBeenCalledWith(404);
    expect(response.end).toHaveBeenCalledOnce();
  });
});
