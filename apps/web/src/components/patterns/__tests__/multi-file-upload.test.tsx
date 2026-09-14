import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { MultiFileUpload, type UploadedFile } from '../multi-file-upload';

vi.mock('@/hooks/use-authenticated-file', () => ({
  useAuthenticatedFileUrl: (downloadUrl: string | undefined) =>
    downloadUrl ? `blob:${downloadUrl}` : undefined,
  downloadAuthenticatedFile: vi.fn(),
}));

const existingImage: UploadedFile = {
  id: 'file-1',
  name: '现场照片.png',
  url: 'https://public.example.com/uploads/storage-key.png',
  downloadUrl: '/api/v1/upload/file/signed-token',
  size: 3072,
  mimeType: 'image/png',
};

describe('MultiFileUpload', () => {
  it('只读图片只使用鉴权请求生成的 blob，不暴露持久化地址', () => {
    const { container } = render(
      <MultiFileUpload
        value={[existingImage]}
        onUpload={vi.fn()}
        readOnly
        data-testid="attachments"
      />
    );

    expect(screen.getByAltText('现场照片.png').getAttribute('src')).toBe(
      `blob:${existingImage.downloadUrl}`
    );
    expect(container.innerHTML).not.toContain(existingImage.url);
    expect(screen.queryByTestId('attachments-dropzone')).toBeNull();
  });

  it('缺少签名下载地址时不使用持久化地址渲染图片', () => {
    const { container } = render(
      <MultiFileUpload
        value={[{ ...existingImage, downloadUrl: undefined }]}
        onUpload={vi.fn()}
        readOnly
        data-testid="attachments"
      />
    );

    expect(screen.queryByAltText('现场照片.png')).toBeNull();
    expect(container.innerHTML).not.toContain(existingImage.url);
  });

  it('上传入口使用可聚焦原生按钮并关联文件 input 与校验错误', () => {
    render(
      <MultiFileUpload value={[]} onUpload={vi.fn()} maxFiles={1} data-testid="attachments" />
    );

    const trigger = screen.getByRole('button', { name: /点击上传/ });
    const input = screen.getByTestId('attachments-input');
    expect(trigger.tagName).toBe('BUTTON');
    expect(trigger.getAttribute('aria-controls')).toBe(input.id);
    expect(input.getAttribute('aria-labelledby')).toBe(trigger.id);

    trigger.focus();
    expect(document.activeElement).toBe(trigger);

    const first = new File(['a'], 'a.png', { type: 'image/png' });
    const second = new File(['b'], 'b.png', { type: 'image/png' });
    fireEvent.change(input, { target: { files: [first, second] } });

    const error = screen.getByRole('alert');
    expect(error.textContent).toContain('本次最多还能选择 1 个文件');
    expect(trigger.getAttribute('aria-describedby')?.split(' ')).toContain(error.id);
    expect(trigger.getAttribute('aria-invalid')).toBe('true');
  });

  it('并发选择批次按选择顺序基于 latest value 原子合并，并为在途文件预留 maxFiles', async () => {
    let resolveFirst:
      | ((result: { id: string; url: string; downloadUrl: string }) => void)
      | undefined;
    let resolveSecond:
      | ((result: { id: string; url: string; downloadUrl: string }) => void)
      | undefined;
    const firstUpload = new Promise<{ id: string; url: string; downloadUrl: string }>((resolve) => {
      resolveFirst = resolve;
    });
    const secondUpload = new Promise<{ id: string; url: string; downloadUrl: string }>(
      (resolve) => {
        resolveSecond = resolve;
      }
    );
    const onUpload = vi.fn().mockReturnValueOnce(firstUpload).mockReturnValueOnce(secondUpload);
    const onChange = vi.fn();
    render(
      <MultiFileUpload
        value={[existingImage]}
        onUpload={onUpload}
        onChange={onChange}
        maxFiles={3}
        data-testid="attachments"
      />
    );
    const input = screen.getByTestId('attachments-input');
    const first = new File(['a'], '先选.png', { type: 'image/png' });
    const second = new File(['b'], '后选.png', { type: 'image/png' });

    fireEvent.change(input, { target: { files: [first] } });
    fireEvent.change(input, { target: { files: [second] } });

    expect(onUpload).toHaveBeenCalledTimes(2);
    expect(input.getAttribute('disabled')).not.toBeNull();
    expect(screen.getByText(/已达到最多 3 个文件/)).toBeTruthy();

    resolveSecond?.({ id: 'second', url: '/second', downloadUrl: '/download/second' });
    await Promise.resolve();
    expect(onChange).not.toHaveBeenCalled();

    resolveFirst?.({ id: 'first', url: '/first', downloadUrl: '/download/first' });
    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(2));
    expect(onChange.mock.calls[0]?.[0]).toEqual([
      existingImage,
      expect.objectContaining({ id: 'first', name: '先选.png' }),
    ]);
    expect(onChange.mock.calls[1]?.[0]).toEqual([
      existingImage,
      expect.objectContaining({ id: 'first', name: '先选.png' }),
      expect.objectContaining({ id: 'second', name: '后选.png' }),
    ]);
  });

  it('并行上传完成后一次性追加所有成功文件', async () => {
    const onChange = vi.fn();
    const onUpload = vi
      .fn()
      .mockResolvedValueOnce({
        id: 'file-2',
        url: '/uploads/private/a-key.png',
        downloadUrl: '/api/v1/upload/file/a-token',
      })
      .mockResolvedValueOnce({
        id: 'file-3',
        url: '/uploads/private/b-key.pdf',
        downloadUrl: '/api/v1/upload/file/b-token',
      });
    render(
      <MultiFileUpload
        value={[existingImage]}
        onUpload={onUpload}
        onChange={onChange}
        data-testid="attachments"
      />
    );
    const image = new File(['a'], '新增照片.png', { type: 'image/png' });
    const pdf = new File(['b'], '新增合同.pdf', { type: 'application/pdf' });

    fireEvent.change(screen.getByTestId('attachments-input'), {
      target: { files: [image, pdf] },
    });

    await waitFor(() => expect(onUpload).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(onChange).toHaveBeenCalledWith([
        existingImage,
        {
          id: 'file-2',
          name: '新增照片.png',
          url: '/uploads/private/a-key.png',
          downloadUrl: '/api/v1/upload/file/a-token',
          size: image.size,
          mimeType: 'image/png',
        },
        {
          id: 'file-3',
          name: '新增合同.pdf',
          url: '/uploads/private/b-key.pdf',
          downloadUrl: '/api/v1/upload/file/b-token',
          size: pdf.size,
          mimeType: 'application/pdf',
        },
      ])
    );
  });
});
