import type { CallHandler, ExecutionContext } from '@nestjs/common';
import { firstValueFrom, of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { AttachmentDownloadUrlInterceptor } from './attachment-download-url.interceptor';

function contextWithUser(user?: { id: string; employeeId?: string }): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ user }),
    }),
  } as unknown as ExecutionContext;
}

describe('AttachmentDownloadUrlInterceptor', () => {
  const uploadService = {
    isManagedFileUrl: vi.fn((url: string) => url.includes('localhost:3000/uploads')),
    attachmentCandidateKey: vi.fn((id: string, url: string) => `${id}\u0000${url}`),
    createRegisteredAttachmentDownloadUrls: vi.fn(
      async (candidates: Array<{ id: string; url: string; name?: string }>, employeeId: string) =>
        new Map(
          candidates.map((candidate) => [
            `${candidate.id}\u0000${candidate.url}`,
            `/api/v1/upload/file/signed-${employeeId}-${candidate.name}`,
          ])
        )
    ),
  };

  it('只为已通过业务接口返回的附件签发当前员工下载地址', async () => {
    const interceptor = new AttachmentDownloadUrlInterceptor(uploadService as never);
    const response = {
      items: [
        {
          id: 'attachment-1',
          name: '合同.pdf',
          url: 'http://localhost:3000/uploads/upload/20260727/contract.pdf',
          mimeType: 'application/pdf',
          size: 100,
        },
      ],
    };
    const next: CallHandler = { handle: () => of(response) };

    const result = await firstValueFrom(
      interceptor.intercept(contextWithUser({ id: 'employee-1' }), next)
    );

    expect(result).toBe(response);
    expect((response.items[0] as Record<string, unknown> | undefined)?.downloadUrl).toBe(
      '/api/v1/upload/file/signed-employee-1-合同.pdf'
    );
  });

  it('不装饰外部 URL 或没有登录身份的响应', async () => {
    const interceptor = new AttachmentDownloadUrlInterceptor(uploadService as never);
    const external = {
      name: '外链',
      url: 'https://example.com/file.pdf',
      mimeType: 'application/pdf',
    };

    await firstValueFrom(
      interceptor.intercept(contextWithUser({ id: 'employee-1' }), {
        handle: () => of(external),
      })
    );
    expect(external).not.toHaveProperty('downloadUrl');

    const managed = {
      name: '内部文件',
      url: 'http://localhost:3000/uploads/upload/file.pdf',
      mimeType: 'application/pdf',
    };
    await firstValueFrom(
      interceptor.intercept(contextWithUser(), {
        handle: () => of(managed),
      })
    );
    expect(managed).not.toHaveProperty('downloadUrl');
  });

  it('FileAsset 身份校验不通过时不签发下载地址', async () => {
    uploadService.createRegisteredAttachmentDownloadUrls.mockResolvedValueOnce(new Map());
    const interceptor = new AttachmentDownloadUrlInterceptor(uploadService as never);
    const forged = {
      id: 'forged-id',
      name: '搬来的文件.pdf',
      url: 'http://localhost:3000/uploads/upload/20260727/leaked.pdf',
      mimeType: 'application/pdf',
    };

    await firstValueFrom(
      interceptor.intercept(contextWithUser({ id: 'employee-1' }), {
        handle: () => of(forged),
      })
    );

    expect(forged).not.toHaveProperty('downloadUrl');
  });
});
