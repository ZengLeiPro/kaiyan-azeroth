import { BadRequestException, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as fsp from 'fs/promises';
import { tmpdir } from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { UploadService } from '../upload.service';

vi.mock('fs/promises', async () => {
  const actual = await vi.importActual<typeof import('fs/promises')>('fs/promises');
  return {
    ...actual,
    readdir: vi.fn((target: string, options?: object) => actual.readdir(target, options)),
    unlink: vi.fn((target: string) => actual.unlink(target)),
  };
});

vi.mock('crypto', async () => {
  const actual = await vi.importActual<typeof import('crypto')>('crypto');
  return { ...actual, randomBytes: vi.fn(), randomUUID: vi.fn() };
});

function buildFile(overrides: Record<string, unknown> = {}) {
  return {
    originalname: 'test-image.png',
    buffer: Buffer.from('fake-image-data'),
    size: 1024,
    mimetype: 'image/png',
    ...overrides,
  };
}

function tokenFrom(url: string): string {
  return url.split('/').at(-1) ?? '';
}

async function readStream(stream: fs.ReadStream): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf8');
}

// UploadPathSecurity intentionally requires Linux /proc/self/fd. These filesystem
// integration tests run on the Ubuntu CI runner; macOS still runs the platform
// fail-closed contract in upload.security.spec.ts.
describe.runIf(process.platform === 'linux')('UploadService', () => {
  let actualFsp: typeof import('fs/promises');
  let uploadDir: string;
  let service: UploadService;
  let cryptoModule: typeof import('crypto');
  const services = new Set<UploadService>();
  const cleanupPaths = new Set<string>();
  const executeRaw = vi.fn().mockResolvedValue(1);
  const mockPrisma = {
    fileAsset: {
      create: vi.fn(),
      deleteMany: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
    },
    $transaction: vi.fn(),
  };

  function createService(
    root = uploadDir,
    overrides: { baseUrl?: string; port?: number; publicApiBaseUrl?: string } = {}
  ): UploadService {
    const configService = {
      get: vi.fn((key: string) => {
        if (key === 'UPLOAD_DIR') return root;
        if (key === 'UPLOAD_BASE_URL') return overrides.baseUrl;
        if (key === 'PORT') return overrides.port ?? 3000;
        if (key === 'API_PREFIX') return 'api';
        if (key === 'PUBLIC_API_BASE_URL') {
          return overrides.publicApiBaseUrl ?? 'http://localhost:3000';
        }
        if (key === 'JWT_SECRET') return 'test-jwt-secret-for-upload-signing';
        return undefined;
      }),
    };
    const created = new UploadService(
      configService as unknown as ConfigService,
      mockPrisma as never
    );
    services.add(created);
    return created;
  }

  beforeEach(async () => {
    vi.clearAllMocks();
    actualFsp = await vi.importActual<typeof import('fs/promises')>('fs/promises');
    vi.mocked(fsp.readdir).mockImplementation((target, options) =>
      actualFsp.readdir(target, options)
    );
    vi.mocked(fsp.unlink).mockImplementation((target) => actualFsp.unlink(target));
    cryptoModule = await import('crypto');

    let hashIndex = 0;
    vi.mocked(cryptoModule.randomBytes).mockImplementation(() => {
      const value = hashIndex.toString(16).padStart(32, '0');
      hashIndex += 1;
      return Buffer.from(value, 'hex');
    });
    let uuidIndex = 0;
    vi.mocked(cryptoModule.randomUUID).mockImplementation(() => {
      uuidIndex += 1;
      return `11111111-1111-4111-8111-${uuidIndex.toString().padStart(12, '0')}`;
    });

    uploadDir = await actualFsp.mkdtemp(path.join(tmpdir(), 'upload-service-'));
    cleanupPaths.add(uploadDir);
    mockPrisma.fileAsset.create.mockImplementation(async ({ data }: { data: { id: string } }) => ({
      id: data.id,
    }));
    mockPrisma.fileAsset.findMany.mockResolvedValue([]);
    mockPrisma.fileAsset.count.mockResolvedValue(0);
    mockPrisma.fileAsset.deleteMany.mockResolvedValue({ count: 0 });
    mockPrisma.$transaction.mockImplementation(
      async (callback: (transaction: unknown) => Promise<unknown>) =>
        callback({ ...mockPrisma, $executeRaw: executeRaw })
    );
    service = createService(uploadDir, { baseUrl: 'http://localhost:3000/uploads' });
  });

  afterEach(async () => {
    for (const created of services) await created.onModuleDestroy().catch(() => undefined);
    services.clear();
    vi.restoreAllMocks();
    for (const cleanupPath of Array.from(cleanupPaths).reverse()) {
      await actualFsp.rm(cleanupPath, { recursive: true, force: true });
      cleanupPaths.delete(cleanupPath);
    }
  });

  describe('uploadFile', () => {
    it('should upload a file and return correct structure', async () => {
      const result = await service.uploadFile(buildFile(), 'employee-1');

      expect(result).toEqual(
        expect.objectContaining({
          originalName: 'test-image.png',
          size: 1024,
          mimeType: 'image/png',
          id: '11111111-1111-4111-8111-000000000001',
        })
      );
      expect(result.downloadUrl).toMatch(/^\/api\/v1\/upload\/file\//);
      expect(result.url).toContain('http://localhost:3000/uploads/');
      expect(result.filename).toMatch(/^\d+-[0-9a-f]{32}\.png$/);
      expect(
        await actualFsp.readFile(
          path.join(uploadDir, result.url.split('/').slice(-2).join('/')),
          'utf8'
        )
      ).toBe('fake-image-data');
    });

    it('should throw BadRequestException when no file is provided', async () => {
      // @ts-expect-error: testing null input for runtime guard
      await expect(service.uploadFile(null, 'employee-1')).rejects.toThrow(BadRequestException);
    });

    it('should generate a unique filename with crypto hash', async () => {
      const result = await service.uploadFile(buildFile(), 'employee-1');
      expect(result.filename).toMatch(/^\d+-0{32}\.png$/);
    });

    it('should create the date subdirectory beneath the fixed upload root', async () => {
      const result = await service.uploadFile(buildFile(), 'employee-1');
      const storageKey = new URL(result.url).pathname.split('/uploads/')[1];
      if (!storageKey) throw new Error('missing storage key');
      expect(
        (await actualFsp.stat(path.dirname(path.join(uploadDir, storageKey)))).isDirectory()
      ).toBe(true);
    });

    it('should write file buffer to disk', async () => {
      const file = buildFile();
      const result = await service.uploadFile(file, 'employee-1');
      const storageKey = new URL(result.url).pathname.split('/uploads/')[1];
      if (!storageKey) throw new Error('missing storage key');
      expect(await actualFsp.readFile(path.join(uploadDir, storageKey))).toEqual(file.buffer);
    });

    it('should record immutable storage metadata and uploader under the same advisory lock', async () => {
      await service.uploadFile(buildFile(), 'employee-1');

      expect(mockPrisma.fileAsset.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          id: '11111111-1111-4111-8111-000000000001',
          ownerEmployeeId: 'employee-1',
          originalName: 'test-image.png',
          size: 1024,
          mimeType: 'image/png',
          storageKey: expect.stringMatching(/^\d{8}\/.+\.png$/),
        }),
        select: { id: true },
      });
      expect(executeRaw).toHaveBeenCalledOnce();
      expect(executeRaw.mock.invocationCallOrder[0]).toBeLessThan(
        mockPrisma.fileAsset.create.mock.invocationCallOrder[0] ?? Number.MAX_SAFE_INTEGER
      );
    });

    it('should remove only the newly written file when asset registration fails', async () => {
      mockPrisma.fileAsset.create.mockRejectedValueOnce(new Error('database unavailable'));

      await expect(service.uploadFile(buildFile(), 'employee-1')).rejects.toThrow(
        'File upload failed'
      );
      expect(mockPrisma.$transaction).toHaveBeenCalledTimes(3);
      const dateDirectories = (await actualFsp.readdir(uploadDir, { withFileTypes: true })).filter(
        (entry) => entry.isDirectory() && /^\d{8}$/.test(entry.name)
      );
      for (const directory of dateDirectories) {
        const files = await actualFsp.readdir(path.join(uploadDir, directory.name));
        expect(files.filter((name) => name.endsWith('.png'))).toEqual([]);
      }
    });

    it('does not swallow unlink EACCES after a database failure', async () => {
      mockPrisma.fileAsset.create.mockRejectedValueOnce(new Error('database unavailable'));
      vi.mocked(fsp.unlink).mockRejectedValueOnce(
        Object.assign(new Error('permission denied'), { code: 'EACCES' })
      );
      const loggerError = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

      await expect(service.uploadFile(buildFile(), 'employee-1')).rejects.toThrow(
        'File upload failed and cleanup was incomplete'
      );
      expect(loggerError).toHaveBeenCalledWith(
        expect.objectContaining({
          event: 'upload.single.file-cleanup.failed',
          failedItems: [expect.objectContaining({ cleanupFailureCode: 'EACCES' })],
        })
      );
    });
  });

  describe('uploadFiles', () => {
    it('should upload multiple files and return results array', async () => {
      const results = await service.uploadFiles(
        [buildFile({ originalname: 'a.png' }), buildFile({ originalname: 'b.jpg' })],
        'employee-1'
      );

      expect(results).toHaveLength(2);
      expect(results[0]?.originalName).toBe('a.png');
      expect(results[1]?.originalName).toBe('b.jpg');
      expect(mockPrisma.fileAsset.create).toHaveBeenCalledTimes(2);
      expect(executeRaw).toHaveBeenCalledTimes(2);
    });

    it('should throw BadRequestException when no files are provided', async () => {
      await expect(service.uploadFiles([], 'employee-1')).rejects.toThrow(BadRequestException);
      // @ts-expect-error: testing null input for runtime guard
      await expect(service.uploadFiles(null, 'employee-1')).rejects.toThrow(BadRequestException);
    });
  });

  describe('deleteFile', () => {
    it('should find and delete the file', async () => {
      const targetFilename = 'target-file.png';
      const target = path.join(uploadDir, '20260516', targetFilename);
      await actualFsp.mkdir(path.dirname(target), { recursive: true });
      await actualFsp.writeFile(target, 'target');

      expect(await service.deleteFile(targetFilename)).toEqual({ success: true });
      await expect(actualFsp.access(target)).rejects.toThrow();
    });

    it('should return { success: false } when file is not found', async () => {
      expect(await service.deleteFile('nonexistent.png')).toEqual({ success: false });
    });

    it('should not throw on errors and return { success: false }', async () => {
      vi.mocked(fsp.readdir).mockRejectedValueOnce(new Error('EACCES: permission denied'));
      expect(await service.deleteFile('any-file.png')).toEqual({ success: false });
    });
  });

  describe('signed download', () => {
    it('should return stream only for the employee bound to the token', async () => {
      const storageKey = '20260305/test-file.png';
      await actualFsp.mkdir(path.join(uploadDir, '20260305'), { recursive: true });
      await actualFsp.writeFile(path.join(uploadDir, storageKey), 'download-content');
      const token = tokenFrom(
        service.createDownloadUrl(
          `http://localhost:3000/uploads/${storageKey}`,
          'employee-1',
          '客户照片.png'
        )
      );

      const result = await service.getFileStreamByToken(token, 'employee-1');

      expect(result.filename).toBe('客户照片.png');
      expect(result.storageKey).toBe(storageKey);
      expect(result.mimeType).toBe('image/png');
      expect(await readStream(result.stream)).toBe('download-content');
    });

    it('should sign only attachments whose FileAsset id and storage key both match', async () => {
      mockPrisma.fileAsset.findMany.mockResolvedValue([
        { id: 'asset-valid', storageKey: '20260305/valid.pdf' },
        { id: 'asset-other', storageKey: '20260305/other.pdf' },
      ]);

      const result = await service.createRegisteredAttachmentDownloadUrls(
        [
          {
            id: 'asset-valid',
            url: 'http://localhost:3000/uploads/20260305/valid.pdf',
            name: '有效.pdf',
          },
          {
            id: 'asset-other',
            url: 'http://localhost:3000/uploads/20260305/leaked.pdf',
            name: '搬来的.pdf',
          },
          {
            id: 'asset-missing',
            url: 'http://localhost:3000/uploads/20260305/missing.pdf',
          },
        ],
        'employee-1'
      );

      expect(
        result.get(
          service.attachmentCandidateKey(
            'asset-valid',
            'http://localhost:3000/uploads/20260305/valid.pdf'
          )
        )
      ).toMatch(/^\/api\/v1\/upload\/file\//);
      expect(result.size).toBe(1);
    });

    it('should throw NotFoundException when file does not exist', async () => {
      const token = tokenFrom(
        service.createDownloadUrl(
          'http://localhost:3000/uploads/20260305/missing.png',
          'employee-1'
        )
      );
      await expect(service.getFileStreamByToken(token, 'employee-1')).rejects.toThrow(
        NotFoundException
      );
    });

    it('should reject a valid token when used by another employee', async () => {
      const token = tokenFrom(
        service.createDownloadUrl(
          'http://localhost:3000/uploads/20260305/test-file.png',
          'employee-1'
        )
      );
      await expect(service.getFileStreamByToken(token, 'employee-2')).rejects.toThrow(
        BadRequestException
      );
    });

    it('should reject a tampered token', async () => {
      const token = tokenFrom(
        service.createDownloadUrl(
          'http://localhost:3000/uploads/20260305/test-file.png',
          'employee-1'
        )
      );
      const tampered = `${token.slice(0, -1)}${token.endsWith('a') ? 'b' : 'a'}`;
      await expect(service.getFileStreamByToken(tampered, 'employee-1')).rejects.toThrow(
        BadRequestException
      );
    });

    it('should reject an expired token', async () => {
      const now = Date.now();
      const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(now);
      const token = tokenFrom(
        service.createDownloadUrl(
          'http://localhost:3000/uploads/20260305/test-file.png',
          'employee-1'
        )
      );
      nowSpy.mockReturnValue(now + 60 * 60 * 1000 + 1000);
      await expect(service.getFileStreamByToken(token, 'employee-1')).rejects.toThrow(
        BadRequestException
      );
    });

    it('should reject encoded directory traversal before signing', () => {
      expect(() =>
        service.createDownloadUrl(
          'http://localhost:3000/uploads/%2e%2e/%2e%2e/etc/passwd',
          'employee-1'
        )
      ).toThrow(BadRequestException);
    });

    it('should reject cross-origin URLs before signing', () => {
      expect(() =>
        service.createDownloadUrl(
          'https://evil.example.com/uploads/20260305/file.pdf',
          'employee-1'
        )
      ).toThrow(BadRequestException);
    });

    it('should reject same-origin URLs outside the upload directory', () => {
      expect(() =>
        service.createDownloadUrl('http://localhost:3000/api/users/list', 'employee-1')
      ).toThrow(BadRequestException);
    });

    it('should keep compatibility with historical /upload/ singular paths', () => {
      expect(
        service.createDownloadUrl('http://localhost:3000/upload/20260305/file.pdf', 'employee-1')
      ).toMatch(/^\/api\/v1\/upload\/file\//);
    });
  });

  describe('signed image preview', () => {
    it('should sign only registered images with matching storage keys', async () => {
      mockPrisma.fileAsset.findMany.mockResolvedValue([
        { id: 'image-valid', storageKey: '20260305/valid.jpg', mimeType: 'image/jpeg' },
        { id: 'image-other', storageKey: '20260305/other.jpg', mimeType: 'image/jpeg' },
        { id: 'pdf-valid', storageKey: '20260305/file.pdf', mimeType: 'application/pdf' },
      ]);
      const validUrl = 'http://localhost:3000/uploads/20260305/valid.jpg';

      const result = await service.createRegisteredImagePreviewUrls(
        [
          { id: 'image-valid', url: validUrl, mimeType: 'image/jpeg' },
          {
            id: 'image-other',
            url: 'http://localhost:3000/uploads/20260305/leaked.jpg',
            mimeType: 'image/jpeg',
          },
          {
            id: 'pdf-valid',
            url: 'http://localhost:3000/uploads/20260305/file.pdf',
            mimeType: 'application/pdf',
          },
        ],
        'employee-1'
      );

      expect(result.get(service.attachmentCandidateKey('image-valid', validUrl))).toMatch(
        /^http:\/\/localhost:3000\/api\/v1\/upload\/preview\//
      );
      expect(result.size).toBe(1);
      expect(mockPrisma.fileAsset.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            id: { in: ['image-valid', 'image-other', 'pdf-valid'] },
            ownerEmployeeId: 'employee-1',
          },
        })
      );
    });

    it('should reject an attachment MIME that differs from FileAsset', async () => {
      mockPrisma.fileAsset.findMany.mockResolvedValue([
        { id: 'image-valid', storageKey: '20260305/valid.jpg', mimeType: 'image/jpeg' },
      ]);
      const url = 'http://localhost:3000/uploads/20260305/valid.jpg';
      const result = await service.createRegisteredImagePreviewUrls(
        [{ id: 'image-valid', url, mimeType: 'image/png' }],
        'employee-1'
      );
      expect(result.size).toBe(0);
    });

    it('should serve a valid signed image preview token', async () => {
      const storageKey = '20260305/valid.jpg';
      await actualFsp.mkdir(path.join(uploadDir, '20260305'), { recursive: true });
      await actualFsp.writeFile(path.join(uploadDir, storageKey), 'preview-content');
      mockPrisma.fileAsset.findMany.mockResolvedValue([
        { id: 'image-valid', storageKey, mimeType: 'image/jpeg' },
      ]);
      const url = `http://localhost:3000/uploads/${storageKey}`;
      const previewUrls = await service.createRegisteredImagePreviewUrls(
        [{ id: 'image-valid', url, mimeType: 'image/jpeg' }],
        'employee-1'
      );
      const token = tokenFrom(
        previewUrls.get(service.attachmentCandidateKey('image-valid', url)) ?? ''
      );

      const result = await service.getImagePreviewStreamByToken(token);

      expect(result).toEqual(
        expect.objectContaining({
          storageKey,
          mimeType: 'image/jpeg',
          expiresAt: expect.any(Number),
        })
      );
      expect(await readStream(result.stream)).toBe('preview-content');
    });

    it('should reject tampered and expired image preview tokens', async () => {
      const now = Date.now();
      const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(now);
      mockPrisma.fileAsset.findMany.mockResolvedValue([
        { id: 'image-valid', storageKey: '20260305/valid.jpg', mimeType: 'image/jpeg' },
      ]);
      const url = 'http://localhost:3000/uploads/20260305/valid.jpg';
      const previewUrls = await service.createRegisteredImagePreviewUrls(
        [{ id: 'image-valid', url, mimeType: 'image/jpeg' }],
        'employee-1'
      );
      const token = tokenFrom(
        previewUrls.get(service.attachmentCandidateKey('image-valid', url)) ?? ''
      );
      const tampered = `${token.slice(0, -1)}${token.endsWith('a') ? 'b' : 'a'}`;

      await expect(service.getImagePreviewStreamByToken(tampered)).rejects.toThrow(
        BadRequestException
      );
      nowSpy.mockReturnValue(now + 60 * 60 * 1000 + 1000);
      await expect(service.getImagePreviewStreamByToken(token)).rejects.toThrow(
        BadRequestException
      );
    });
  });

  describe('startup configuration', () => {
    it('should create upload directory if it does not exist', async () => {
      const missingRoot = path.join(uploadDir, 'missing', 'nested');
      const missingService = createService(missingRoot, {
        baseUrl: 'http://localhost:3000/uploads',
      });

      await missingService.onModuleInit();

      expect((await actualFsp.stat(missingRoot)).isDirectory()).toBe(true);
    });

    it('should fall back to default baseUrl when UPLOAD_BASE_URL is not configured', async () => {
      const fallbackService = createService(uploadDir, { port: 4000 });
      const result = await fallbackService.uploadFile(buildFile(), 'employee-1');
      expect(result.url).toContain('http://localhost:4000/uploads/');
    });
  });
});
