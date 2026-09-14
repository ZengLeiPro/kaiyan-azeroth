import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { FileUpload, type UploadedFile } from '../file-upload';

vi.mock('@/hooks/use-authenticated-file', () => ({
  useAuthenticatedFileUrl: (downloadUrl: string | undefined) =>
    downloadUrl ? `blob:${downloadUrl}` : undefined,
  downloadAuthenticatedFile: vi.fn(),
}));

const existingImage: UploadedFile = {
  id: 'file-1',
  name: '凭证.png',
  url: 'https://public.example.com/uploads/storage-key.png',
  downloadUrl: '/api/v1/upload/file/signed-token',
  size: 2048,
  mimeType: 'image/png',
};

describe('FileUpload', () => {
  it('图片预览通过带登录态的请求转换为 blob，不直接导航签名地址', () => {
    const { container } = render(
      <FileUpload value={existingImage} onUpload={vi.fn()} data-testid="attachment" />
    );

    expect(screen.getByTestId('attachment-image-preview').getAttribute('src')).toBe(
      `blob:${existingImage.downloadUrl}`
    );
    expect(container.innerHTML).not.toContain(existingImage.url);
  });

  it('缺少签名下载地址时不回退到持久化存储地址', () => {
    const { container } = render(
      <FileUpload
        value={{ ...existingImage, downloadUrl: undefined }}
        onUpload={vi.fn()}
        data-testid="attachment"
      />
    );

    expect(screen.queryByTestId('attachment-image-preview')).toBeNull();
    expect(container.innerHTML).not.toContain(existingImage.url);
  });

  it('上传完成后向业务表单写入 id 与签名下载地址', async () => {
    const onChange = vi.fn();
    const onUpload = vi.fn().mockResolvedValue({
      id: 'file-2',
      url: '/uploads/private/new-key.png',
      downloadUrl: '/api/v1/upload/file/new-signed-token',
    });
    render(<FileUpload onUpload={onUpload} onChange={onChange} data-testid="attachment" />);
    const file = new File(['image'], '新凭证.png', { type: 'image/png' });

    fireEvent.change(screen.getByTestId('attachment-input'), {
      target: { files: [file] },
    });

    await waitFor(() => expect(onUpload).toHaveBeenCalledWith(file));
    await waitFor(() =>
      expect(onChange).toHaveBeenCalledWith({
        id: 'file-2',
        name: '新凭证.png',
        url: '/uploads/private/new-key.png',
        downloadUrl: '/api/v1/upload/file/new-signed-token',
        size: file.size,
        mimeType: 'image/png',
      })
    );
  });

  it('超出大小限制时阻断上传', async () => {
    const onUpload = vi.fn();
    render(<FileUpload onUpload={onUpload} maxSize={1} data-testid="attachment" />);
    const oversized = new File([new Uint8Array(1024 * 1024 + 1)], '超大.png', {
      type: 'image/png',
    });

    fireEvent.change(screen.getByTestId('attachment-input'), {
      target: { files: [oversized] },
    });

    expect(await screen.findByText('文件大小不能超过 1MB')).not.toBeNull();
    expect(onUpload).not.toHaveBeenCalled();
  });
});
