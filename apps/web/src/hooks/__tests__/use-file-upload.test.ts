import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { api } from '@/lib/api';

import { useFileUpload } from '../use-file-upload';

vi.mock('@/lib/api', () => ({
  api: {
    post: vi.fn(),
  },
}));

describe('useFileUpload', () => {
  beforeEach(() => {
    vi.mocked(api.post).mockReset();
  });

  it('上传文件并只返回服务端签发的下载地址', async () => {
    vi.mocked(api.post).mockResolvedValueOnce({
      data: {
        id: 'file-1',
        url: '/uploads/private/storage-key.png',
        downloadUrl: '/api/v1/upload/file/signed-token',
      },
    });
    const file = new File(['image'], '发票.png', { type: 'image/png' });
    const { result } = renderHook(() => useFileUpload());

    let uploaded;
    await act(async () => {
      uploaded = await result.current.uploadFile(file);
    });

    expect(api.post).toHaveBeenCalledTimes(1);
    const [endpoint, body, config] = vi.mocked(api.post).mock.calls[0]!;
    expect(endpoint).toBe('/upload');
    expect(body).toBeInstanceOf(FormData);
    expect((body as FormData).get('file')).toBe(file);
    expect(config).toEqual({
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    });
    expect(uploaded).toEqual({
      id: 'file-1',
      url: '/uploads/private/storage-key.png',
      downloadUrl: '/api/v1/upload/file/signed-token',
    });
  });

  it('支持业务模块覆盖上传端点', async () => {
    vi.mocked(api.post).mockResolvedValueOnce({
      data: {
        id: 'file-2',
        url: '/uploads/private/storage-key.pdf',
        downloadUrl: '/api/v1/upload/file/another-token',
      },
    });
    const file = new File(['pdf'], '合同.pdf', { type: 'application/pdf' });
    const { result } = renderHook(() => useFileUpload({ endpoint: '/custom-upload' }));

    await act(async () => {
      await result.current.uploadFile(file);
    });

    expect(api.post).toHaveBeenCalledWith(
      '/custom-upload',
      expect.any(FormData),
      expect.any(Object)
    );
  });
});
