import { BadRequestException, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as fsp from 'fs/promises';
import { tmpdir } from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { UploadService } from '../upload.service';
import { UploadPathSecurity } from '../upload-path-security';

vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return { ...actual, statSync: vi.fn(actual.statSync) };
});

vi.mock('fs/promises', async () => {
  const actual = await vi.importActual<typeof import('fs/promises')>('fs/promises');
  return {
    ...actual,
    open: vi.fn((target: string, flags: string | number, mode?: number) =>
      actual.open(target, flags, mode)
    ),
    rename: vi.fn((source: string, destination: string) => actual.rename(source, destination)),
    unlink: vi.fn((target: string) => actual.unlink(target)),
  };
});

function buildFile() {
  const buffer = Buffer.from('safe-content');
  return {
    originalname: 'safe.png',
    buffer,
    size: buffer.length,
    mimetype: 'image/png',
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

async function listRegularFiles(root: string): Promise<string[]> {
  const result: string[] = [];
  async function visit(directory: string): Promise<void> {
    let entries: fs.Dirent[];
    try {
      entries = await fsp.readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(target);
      else if (entry.isFile()) result.push(target);
    }
  }
  await visit(root);
  return result;
}

async function uploadFdTargets(root: string): Promise<string[]> {
  const fdNames = await fsp.readdir('/proc/self/fd');
  const targets = await Promise.all(
    fdNames.map(async (fdName) => {
      try {
        return await fsp.readlink(`/proc/self/fd/${fdName}`);
      } catch {
        return undefined;
      }
    })
  );
  return targets.filter(
    (target): target is string =>
      typeof target === 'string' && (target === root || target.startsWith(`${root}${path.sep}`))
  );
}

describe.skipIf(process.platform === 'linux')('UploadPathSecurity platform boundary', () => {
  it('fails closed when fixed-directory /proc/self/fd semantics are unavailable', () => {
    expect(() => new UploadPathSecurity('/tmp/uploads')).toThrow(
      'requires Linux /proc/self/fd support'
    );
  });
});

describe('UploadPathSecurity server-side file handle', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function createPathSecurityHarness() {
    const pathSecurity = Object.create(UploadPathSecurity.prototype) as UploadPathSecurity;
    const directory = {
      handles: [],
      handle: { fd: 321 },
      identity: { dev: 1, ino: 2 },
      segments: ['20260824'],
      closed: false,
    };
    const openParent = vi.spyOn(pathSecurity, 'openParent').mockResolvedValue(directory as never);
    const closeDirectory = vi
      .spyOn(pathSecurity, 'closeDirectory')
      .mockImplementation(async (target) => {
        target.closed = true;
      });
    return { pathSecurity, directory, openParent, closeDirectory };
  }

  it('只返回经 fstat 验证的 regular file handle，并释放父目录句柄', async () => {
    const { pathSecurity, directory, openParent, closeDirectory } = createPathSecurityHarness();
    const fileHandle = {
      stat: vi.fn().mockResolvedValue({ isFile: () => true, dev: 7, ino: 9 }),
      close: vi.fn().mockResolvedValue(undefined),
    };
    vi.mocked(fsp.open).mockResolvedValueOnce(fileHandle as never);
    const managedPath = {
      storageKey: '20260824/document.pdf',
      relativePath: '20260824/document.pdf',
      segments: ['20260824', 'document.pdf'],
      parentSegments: ['20260824'],
      entryName: 'document.pdf',
    };

    await expect(pathSecurity.openReadFile(managedPath)).resolves.toEqual({
      handle: fileHandle,
      identity: { dev: 7, ino: 9 },
    });
    expect(openParent).toHaveBeenCalledWith(managedPath, { create: false });
    expect(fsp.open).toHaveBeenCalledWith('/proc/self/fd/321/document.pdf', expect.any(Number));
    expect(closeDirectory).toHaveBeenCalledWith(directory);
    expect(fileHandle.close).not.toHaveBeenCalled();
  });

  it('目标不是 regular file 时关闭文件和父目录句柄并拒绝解析', async () => {
    const { pathSecurity, directory, closeDirectory } = createPathSecurityHarness();
    const fileHandle = {
      stat: vi.fn().mockResolvedValue({ isFile: () => false, dev: 7, ino: 9 }),
      close: vi.fn().mockResolvedValue(undefined),
    };
    vi.mocked(fsp.open).mockResolvedValueOnce(fileHandle as never);
    const managedPath = {
      storageKey: '20260824/not-a-file',
      relativePath: '20260824/not-a-file',
      segments: ['20260824', 'not-a-file'],
      parentSegments: ['20260824'],
      entryName: 'not-a-file',
    };

    await expect(pathSecurity.openReadFile(managedPath)).rejects.toThrow(BadRequestException);
    expect(fileHandle.close).toHaveBeenCalledOnce();
    expect(closeDirectory).toHaveBeenCalledWith(directory);
  });
});

// The adversarial rename/symlink cases depend on real Linux /proc/self/fd
// semantics. They run in Ubuntu CI rather than being emulated with weaker paths.
describe.runIf(process.platform === 'linux')('UploadService fixed-directory path security', () => {
  let actualFs: typeof import('fs');
  let actualFsp: typeof import('fs/promises');
  let uploadDir: string;
  let service: UploadService;
  const cleanupPaths = new Set<string>();
  const services = new Set<UploadService>();
  const executeRaw = vi.fn().mockResolvedValue(1);
  const mockPrisma = {
    fileAsset: {
      create: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      deleteMany: vi.fn(),
    },
    $transaction: vi.fn(),
  };

  function createService(root = uploadDir): UploadService {
    const configService = {
      get: vi.fn((key: string) => {
        if (key === 'UPLOAD_DIR') return root;
        if (key === 'UPLOAD_BASE_URL') return 'http://localhost:3000/uploads';
        if (key === 'PORT') return 3000;
        if (key === 'API_PREFIX') return 'api';
        if (key === 'PUBLIC_API_BASE_URL') return 'https://api.example.test';
        if (key === 'JWT_SECRET') return 'test-upload-signing-secret';
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
    actualFs = await vi.importActual<typeof import('fs')>('fs');
    actualFsp = await vi.importActual<typeof import('fs/promises')>('fs/promises');
    vi.mocked(fs.statSync).mockImplementation(actualFs.statSync);
    vi.mocked(fsp.open).mockImplementation((target, flags, mode) =>
      actualFsp.open(target, flags, mode)
    );
    vi.mocked(fsp.rename).mockImplementation((source, destination) =>
      actualFsp.rename(source, destination)
    );
    vi.mocked(fsp.unlink).mockImplementation((target) => actualFsp.unlink(target));
    uploadDir = await actualFsp.mkdtemp(path.join(tmpdir(), 'upload-security-'));
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
    service = createService();
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

  it('为服务端解析返回绑定到原 inode 的 regular file handle', async () => {
    const storageKey = '20260824/server-parse.pdf';
    const absolutePath = path.join(uploadDir, storageKey);
    await actualFsp.mkdir(path.dirname(absolutePath), { recursive: true });
    await actualFsp.writeFile(absolutePath, 'trusted-parser-input');
    const pathSecurity = new UploadPathSecurity(uploadDir);

    try {
      const opened = await pathSecurity.openReadFile(pathSecurity.prepare(storageKey));
      await actualFsp.unlink(absolutePath);
      await actualFsp.writeFile(absolutePath, 'replacement-content');

      expect(await opened.handle.readFile({ encoding: 'utf8' })).toBe('trusted-parser-input');
      await opened.handle.close();
    } finally {
      await pathSecurity.close();
    }

    expect(await uploadFdTargets(uploadDir)).toEqual([]);
  });

  it('拒绝把目录当作服务端解析文件并释放全部临时句柄', async () => {
    const storageKey = '20260824/not-a-file';
    await actualFsp.mkdir(path.join(uploadDir, storageKey), { recursive: true });
    const pathSecurity = new UploadPathSecurity(uploadDir);

    try {
      await expect(pathSecurity.openReadFile(pathSecurity.prepare(storageKey))).rejects.toThrow(
        BadRequestException
      );
    } finally {
      await pathSecurity.close();
    }

    expect(await uploadFdTargets(uploadDir)).toEqual([]);
  });

  it('signs lexically without filesystem access and serves an existing canonical regular file', async () => {
    const storageKey = '20260824/safe.png';
    const absolutePath = path.join(uploadDir, storageKey);
    await actualFsp.mkdir(path.dirname(absolutePath), { recursive: true });
    await actualFsp.writeFile(absolutePath, 'safe');

    const signed = service.createDownloadUrl(
      `http://localhost:3000/uploads/${storageKey}`,
      'employee-1',
      'safe.png'
    );

    expect(signed).toMatch(/^\/api\/v1\/upload\/file\//);
    expect(fsp.open).not.toHaveBeenCalled();
    const result = await service.getFileStreamByToken(tokenFrom(signed), 'employee-1');
    expect(await readStream(result.stream)).toBe('safe');
  });

  it('signs a lexically valid missing path but the real download stream fails closed', async () => {
    const signed = service.createDownloadUrl(
      'http://localhost:3000/uploads/20260824/missing.png',
      'employee-1'
    );

    expect(fsp.open).not.toHaveBeenCalled();
    await expect(service.getFileStreamByToken(tokenFrom(signed), 'employee-1')).rejects.toThrow(
      NotFoundException
    );
  });

  it.each([
    ['backslash traversal', '20260824%5C..%5Csecret.png'],
    ['POSIX absolute path', '%2Fetc%2Fpasswd'],
    ['Windows absolute path', 'C%3A%5CWindows%5Cwin.ini'],
    ['dot-dot traversal', '20260824%2F..%2Fsecret.png'],
    ['NUL byte', '20260824%2Fbad%00.png'],
  ])('rejects %s before signing', (_label, encodedStorageKey) => {
    expect(() =>
      service.createDownloadUrl(`http://localhost:3000/uploads/${encodedStorageKey}`, 'employee-1')
    ).toThrow(BadRequestException);
  });

  it('rejects a same-prefix sibling escape rather than trusting a lexical prefix', async () => {
    const sibling = `${uploadDir}-evil`;
    cleanupPaths.add(sibling);
    await actualFsp.mkdir(sibling, { recursive: true });
    await actualFsp.writeFile(path.join(sibling, 'secret.png'), 'secret');
    const siblingName = path.basename(sibling);

    expect(() =>
      service.createDownloadUrl(
        `http://localhost:3000/uploads/..%2F${encodeURIComponent(siblingName)}%2Fsecret.png`,
        'employee-1'
      )
    ).toThrow(BadRequestException);
  });

  it('signs a parent symlink lexically but rejects it when opening the real stream', async () => {
    const outside = await actualFsp.mkdtemp(path.join(tmpdir(), 'upload-outside-'));
    cleanupPaths.add(outside);
    await actualFsp.writeFile(path.join(outside, 'secret.png'), 'outside-secret');
    await actualFsp.symlink(outside, path.join(uploadDir, '20260824'), 'dir');

    const signed = service.createDownloadUrl(
      'http://localhost:3000/uploads/20260824/secret.png',
      'employee-1'
    );
    await expect(service.getFileStreamByToken(tokenFrom(signed), 'employee-1')).rejects.toThrow(
      NotFoundException
    );
    expect(await actualFsp.readFile(path.join(outside, 'secret.png'), 'utf8')).toBe(
      'outside-secret'
    );
  });

  it('signs a final symlink lexically but rejects it when opening the real preview stream', async () => {
    const parent = path.join(uploadDir, '20260824');
    await actualFsp.mkdir(parent, { recursive: true });
    await actualFsp.writeFile(path.join(parent, 'real.png'), 'real');
    await actualFsp.symlink('real.png', path.join(parent, 'link.png'));
    mockPrisma.fileAsset.findMany.mockResolvedValue([
      { id: 'image-1', storageKey: '20260824/link.png', mimeType: 'image/png' },
    ]);

    const previews = await service.createRegisteredImagePreviewUrls(
      [
        {
          id: 'image-1',
          url: 'http://localhost:3000/uploads/20260824/link.png',
          mimeType: 'image/png',
        },
      ],
      'employee-1'
    );
    const previewUrl = previews.get(
      service.attachmentCandidateKey('image-1', 'http://localhost:3000/uploads/20260824/link.png')
    );
    expect(previewUrl).toBeDefined();
    await expect(service.getImagePreviewStreamByToken(tokenFrom(previewUrl ?? ''))).rejects.toThrow(
      NotFoundException
    );
  });

  it('fails closed when the named upload root is replaced after initialization', async () => {
    const storageKey = '20260824/secret.png';
    const originalFile = path.join(uploadDir, storageKey);
    await actualFsp.mkdir(path.dirname(originalFile), { recursive: true });
    await actualFsp.writeFile(originalFile, 'trusted-root-content');
    await service.onModuleInit();
    const signed = service.createDownloadUrl(
      `http://localhost:3000/uploads/${storageKey}`,
      'employee-1'
    );

    const oldRoot = `${uploadDir}-old`;
    const outside = await actualFsp.mkdtemp(path.join(tmpdir(), 'upload-root-outside-'));
    cleanupPaths.add(oldRoot);
    cleanupPaths.add(outside);
    await actualFsp.mkdir(path.join(outside, '20260824'));
    await actualFsp.writeFile(path.join(outside, storageKey), 'outside-secret');
    await actualFsp.rename(uploadDir, oldRoot);
    await actualFsp.symlink(outside, uploadDir, 'dir');

    await expect(service.getFileStreamByToken(tokenFrom(signed), 'employee-1')).rejects.toThrow(
      NotFoundException
    );
    expect(await actualFsp.readFile(path.join(outside, storageKey), 'utf8')).toBe('outside-secret');
  });

  it('rejects an upload root configured through a symlink component during module startup', async () => {
    const realRoot = await actualFsp.mkdtemp(path.join(tmpdir(), 'upload-real-root-'));
    const linkedRoot = `${realRoot}-link`;
    cleanupPaths.add(realRoot);
    cleanupPaths.add(linkedRoot);
    await actualFsp.symlink(realRoot, linkedRoot, 'dir');

    const linkedService = createService(linkedRoot);
    await expect(linkedService.onModuleInit()).rejects.toThrow();
  });

  it('fails synchronously when /proc/self/fd capability is unavailable', () => {
    vi.mocked(fs.statSync).mockImplementation((target, options) => {
      if (String(target) === '/proc/self/fd') {
        throw Object.assign(new Error('procfs unavailable'), { code: 'ENOENT' });
      }
      return actualFs.statSync(target, options as never) as never;
    });

    expect(() => createService()).toThrow('requires mounted /proc/self/fd support');
  });

  it('keeps writes bound to a moved parent fd and removes the upload without outside residuals', async () => {
    const movedParent = `${uploadDir}-moved-parent`;
    const outside = await actualFsp.mkdtemp(path.join(tmpdir(), 'upload-open-outside-'));
    cleanupPaths.add(movedParent);
    cleanupPaths.add(outside);
    const loggerError = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    let swapped = false;

    vi.mocked(fsp.open).mockImplementation(async (target, flags, mode) => {
      const handle = await actualFsp.open(target, flags, mode);
      const numericFlags = typeof flags === 'number' ? flags : 0;
      if (!swapped && (numericFlags & fs.constants.O_EXCL) !== 0) {
        const fixedParent = path.dirname(String(target));
        const namedParent = await actualFsp.readlink(fixedParent);
        await actualFsp.rename(namedParent, movedParent);
        await actualFsp.symlink(outside, namedParent, 'dir');
        swapped = true;
      }
      return handle;
    });

    const rejection = await service.uploadFile(buildFile(), 'employee-1').then(
      () => undefined,
      (error: unknown) => error
    );

    expect(rejection).toMatchObject({ message: 'File upload failed' });
    expect(swapped).toBe(true);
    expect(mockPrisma.fileAsset.create).not.toHaveBeenCalled();
    expect(await actualFsp.readdir(outside)).toEqual([]);
    expect(await listRegularFiles(movedParent)).toEqual([]);
    expect(loggerError.mock.calls.flat()).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ event: 'upload.single.file-cleanup.failed' }),
      ])
    );
    expect(JSON.stringify(loggerError.mock.calls)).not.toContain(uploadDir);
  });

  it('never deletes a victim inode swapped into the upload entry before isolation rename', async () => {
    const outside = await actualFsp.mkdtemp(path.join(tmpdir(), 'upload-swap-victim-'));
    cleanupPaths.add(outside);
    const victimPath = path.join(outside, 'victim.txt');
    await actualFsp.writeFile(victimPath, 'victim-content');
    mockPrisma.fileAsset.create.mockRejectedValueOnce(new Error('database unavailable'));
    let swapped = false;

    vi.mocked(fsp.rename).mockImplementation(async (source, destination) => {
      if (!swapped && String(destination).endsWith('/entry')) {
        await actualFsp.unlink(source);
        await actualFsp.link(victimPath, source);
        swapped = true;
      }
      return actualFsp.rename(source, destination);
    });

    await expect(service.uploadFile(buildFile(), 'employee-1')).rejects.toThrow(
      'File upload failed and cleanup was incomplete'
    );

    const createCall = mockPrisma.fileAsset.create.mock.calls[0]?.[0] as
      | { data?: { storageKey?: string } }
      | undefined;
    const storageKey = createCall?.data?.storageKey;
    if (!storageKey) throw new Error('missing created storage key');
    expect(swapped).toBe(true);
    expect(fsp.unlink).not.toHaveBeenCalled();
    expect(await actualFsp.readFile(victimPath, 'utf8')).toBe('victim-content');
    expect(await actualFsp.readFile(path.join(uploadDir, storageKey), 'utf8')).toBe(
      'victim-content'
    );
  });

  it('reads from the already opened FileHandle when the entry is swapped after open', async () => {
    const storageKey = '20260824/safe.png';
    const safePath = path.join(uploadDir, storageKey);
    const outside = await actualFsp.mkdtemp(path.join(tmpdir(), 'upload-read-swap-'));
    cleanupPaths.add(outside);
    const outsidePath = path.join(outside, 'secret.png');
    await actualFsp.mkdir(path.dirname(safePath), { recursive: true });
    await actualFsp.writeFile(safePath, 'safe-opened-content');
    await actualFsp.writeFile(outsidePath, 'outside-secret');
    const signed = service.createDownloadUrl(
      `http://localhost:3000/uploads/${storageKey}`,
      'employee-1'
    );
    let swapped = false;

    vi.mocked(fsp.open).mockImplementation(async (target, flags, mode) => {
      const handle = await actualFsp.open(target, flags, mode);
      const numericFlags = typeof flags === 'number' ? flags : 0;
      if (
        !swapped &&
        String(target).endsWith('/safe.png') &&
        (numericFlags & fs.constants.O_DIRECTORY) === 0
      ) {
        await actualFsp.unlink(target);
        await actualFsp.symlink(outsidePath, target);
        swapped = true;
      }
      return handle;
    });

    const result = await service.getFileStreamByToken(tokenFrom(signed), 'employee-1');

    expect(swapped).toBe(true);
    expect(await readStream(result.stream)).toBe('safe-opened-content');
    expect(await actualFsp.readFile(outsidePath, 'utf8')).toBe('outside-secret');
  });

  it('closes root, parent, failed-entry and stream-owned handles on success and failure paths', async () => {
    const parent = path.join(uploadDir, '20260824');
    await actualFsp.mkdir(parent, { recursive: true });
    await actualFsp.writeFile(path.join(parent, 'safe.png'), 'safe');
    await actualFsp.symlink('safe.png', path.join(parent, 'link.png'));

    const safeToken = tokenFrom(
      service.createDownloadUrl('http://localhost:3000/uploads/20260824/safe.png', 'employee-1')
    );
    const linkToken = tokenFrom(
      service.createDownloadUrl('http://localhost:3000/uploads/20260824/link.png', 'employee-1')
    );
    const result = await service.getFileStreamByToken(safeToken, 'employee-1');
    await readStream(result.stream);
    await expect(service.getFileStreamByToken(linkToken, 'employee-1')).rejects.toThrow(
      NotFoundException
    );

    await service.onModuleDestroy();
    expect(await uploadFdTargets(uploadDir)).toEqual([]);
  });
});
