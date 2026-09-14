import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { api } from '@/lib/api';

import { downloadAuthenticatedFile, toAuthenticatedFileEndpoint } from '../use-authenticated-file';

vi.mock('@/lib/api', () => ({
  api: {
    get: vi.fn(),
  },
}));

describe('authenticated file helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('将同源或 API 绝对地址收敛为 axios baseURL 下的相对路径', () => {
    expect(toAuthenticatedFileEndpoint('/api/v1/upload/file/payload.signature')).toBe(
      'upload/file/payload.signature'
    );
    expect(
      toAuthenticatedFileEndpoint(
        'http://localhost:3000/api/v1/upload/file/payload.signature'
      )
    ).toBe('upload/file/payload.signature');
  });

  it('拒绝不属于 API v1 的下载地址', () => {
    expect(() => toAuthenticatedFileEndpoint('https://evil.example.com/file')).toThrow(
      'Invalid authenticated file URL'
    );
  });

  it('下载通过 api 实例携带 Authorization，再用本地 blob 触发浏览器保存', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: new Blob(['file']) });
    const click = vi.fn();
    const link = { href: '', download: '', click };
    vi.spyOn(document, 'createElement').mockReturnValue(link as never);
    vi.spyOn(document.body, 'appendChild').mockImplementation((node) => node);
    vi.spyOn(document.body, 'removeChild').mockImplementation((node) => node);
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn().mockReturnValue('blob:authenticated-file'),
      revokeObjectURL: vi.fn(),
    });

    await downloadAuthenticatedFile('/api/v1/upload/file/payload.signature', '合同.pdf');

    expect(api.get).toHaveBeenCalledWith('upload/file/payload.signature', {
      responseType: 'blob',
    });
    expect(link.href).toBe('blob:authenticated-file');
    expect(link.download).toBe('合同.pdf');
    expect(click).toHaveBeenCalledOnce();
  });
});
