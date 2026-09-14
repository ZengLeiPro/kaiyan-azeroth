import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { from, type Observable } from 'rxjs';
import { mergeMap } from 'rxjs/operators';

import { UploadService } from '../../modules/upload/upload.service';

interface AuthenticatedRequest {
  user?: {
    id?: string;
    employeeId?: string | null;
  };
}

/**
 * 业务 Controller 已完成数据范围校验后，才为响应中的附件签发当前员工专属下载地址。
 * 规范存储 URL 继续作为不可变引用保存，但不再充当访问凭证。
 */
@Injectable()
export class AttachmentDownloadUrlInterceptor implements NestInterceptor {
  constructor(private readonly uploadService: UploadService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const employeeId = request.user?.employeeId ?? request.user?.id;
    if (!employeeId) return next.handle();

    return next
      .handle()
      .pipe(
        mergeMap((value: unknown) =>
          from(this.decorateAttachments(value, employeeId).then(() => value))
        )
      );
  }

  private async decorateAttachments(value: unknown, employeeId: string): Promise<void> {
    const attachments: Array<{
      record: Record<string, unknown>;
      id: string;
      url: string;
      name?: string;
    }> = [];
    this.collectAttachments(value, new WeakSet<object>(), attachments);
    const downloadUrls = await this.uploadService.createRegisteredAttachmentDownloadUrls(
      attachments.map(({ id, url, name }) => ({ id, url, name })),
      employeeId
    );
    for (const attachment of attachments) {
      const downloadUrl = downloadUrls.get(
        this.uploadService.attachmentCandidateKey(attachment.id, attachment.url)
      );
      if (downloadUrl) attachment.record.downloadUrl = downloadUrl;
    }
  }

  private collectAttachments(
    value: unknown,
    visited: WeakSet<object>,
    attachments: Array<{
      record: Record<string, unknown>;
      id: string;
      url: string;
      name?: string;
    }>
  ): void {
    if (!value || typeof value !== 'object' || value instanceof Date || Buffer.isBuffer(value)) {
      return;
    }
    if (visited.has(value)) return;
    visited.add(value);

    if (Array.isArray(value)) {
      for (const item of value) this.collectAttachments(item, visited, attachments);
      return;
    }

    const record = value as Record<string, unknown>;
    const id = record.id;
    const url = record.url;
    const hasAttachmentShape =
      typeof record.name === 'string' ||
      typeof record.originalName === 'string' ||
      typeof record.mimeType === 'string';
    if (
      typeof id === 'string' &&
      typeof url === 'string' &&
      hasAttachmentShape &&
      this.uploadService.isManagedFileUrl(url)
    ) {
      const originalName =
        typeof record.name === 'string'
          ? record.name
          : typeof record.originalName === 'string'
            ? record.originalName
            : undefined;
      attachments.push({ record, id, url, ...(originalName ? { name: originalName } : {}) });
    }

    for (const [key, child] of Object.entries(record)) {
      if (key !== 'downloadUrl') this.collectAttachments(child, visited, attachments);
    }
  }
}
