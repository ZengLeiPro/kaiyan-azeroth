import type { IAttachment } from '@ky-azeroth/shared/types/common';
import { Prisma } from '@prisma/client';

/**
 * 将附件数组转换为 Prisma JSON 字段格式
 * 支持 IAttachment[] 和宽松格式（兼容 photoAttachmentSchema，size/type 可选）
 * @ts-expect-error: Prisma InputJsonValue 类型需要显式转换以兼容库类型定义
 */
export function toJsonAttachments(
  attachments:
    | Array<{
        id?: string;
        name: string;
        url: string;
        size?: number;
        mimeType?: string;
        type?: string;
      }>
    | undefined
    | null
): Prisma.InputJsonValue | undefined {
  if (!attachments || attachments.length === 0) return undefined;
  return attachments.map((att, index) => ({
    id: att.id || `attachment-${Date.now()}-${index}`,
    name: att.name,
    url: att.url,
    size: att.size || 0,
    mimeType: att.mimeType || att.type || 'application/octet-stream',
  })) as unknown as Prisma.InputJsonValue;
}

export function fromJsonAttachments(value: unknown): IAttachment[] {
  if (!Array.isArray(value)) return [];
  return value.map((att: Record<string, unknown>, index: number) => ({
    id: (att.id as string) || `attachment-${index}`,
    name: (att.name as string) || 'unknown',
    url: (att.url as string) || '',
    size: (att.size as number) || 0,
    mimeType: (att.mimeType || att.type) as string,
  }));
}

/**
 * 通用对象转换为 Prisma JSON 字段格式
 * @ts-expect-error: Prisma InputJsonValue 类型需要显式转换以兼容库类型定义
 */
export function toJsonValue<T>(value: T | undefined | null): Prisma.InputJsonValue | undefined {
  if (value === undefined || value === null) return undefined;
  return value as unknown as Prisma.InputJsonValue;
}

/**
 * 从 Prisma JSON 字段解析对象
 */
export function fromJsonValue<T>(value: unknown): T | undefined {
  if (value === null || value === undefined) return undefined;
  return value as T;
}
