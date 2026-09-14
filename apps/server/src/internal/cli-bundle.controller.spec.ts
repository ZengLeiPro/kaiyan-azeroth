import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { InternalServerErrorException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CliBundleController } from './cli-bundle.controller';

vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
}));

describe('CliBundleController', () => {
  const controller = new CliBundleController();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('返回构建产物中的 SHA256，并剔除文件末尾换行', () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue('a'.repeat(64) + '\n');

    expect(controller.getHash()).toEqual({ sha256: 'a'.repeat(64) });
    expect(readFileSync).toHaveBeenCalledWith(
      join(process.cwd(), 'dist', 'static', 'cli-bundle.sha256'),
      'utf-8'
    );
  });

  it('hash 构建产物缺失时明确拒绝请求', () => {
    vi.mocked(existsSync).mockReturnValue(false);

    expect(() => controller.getHash()).toThrow(InternalServerErrorException);
    expect(readFileSync).not.toHaveBeenCalled();
  });

  it('把同版本 CLI bundle 交给 Express 发送', () => {
    vi.mocked(existsSync).mockReturnValue(true);
    const response = { sendFile: vi.fn() };

    controller.download(response as never);

    expect(response.sendFile).toHaveBeenCalledWith(
      join(process.cwd(), 'dist', 'static', 'cli-bundle.cjs')
    );
  });

  it('bundle 构建产物缺失时不发送空文件', () => {
    vi.mocked(existsSync).mockReturnValue(false);
    const response = { sendFile: vi.fn() };

    expect(() => controller.download(response as never)).toThrow(InternalServerErrorException);
    expect(response.sendFile).not.toHaveBeenCalled();
  });
});
