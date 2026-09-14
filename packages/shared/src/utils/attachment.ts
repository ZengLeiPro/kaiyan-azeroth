import { IAttachment, IAttachmentCreate } from '../types/common';

/**
 * 前端上传文件接口（UI 组件使用）
 */
export interface IUploadedFile {
  id?: string;
  name: string;
  url: string;
  type?: string;
  size?: number;
  mimeType?: string;
}

/**
 * 创建新的附件对象（生成 UUID）
 */
export function createAttachment(data: IAttachmentCreate): IAttachment {
  return {
    ...data,
    id: crypto.randomUUID(),
  };
}

/**
 * 将前端 UploadedFile 转换为后端 IAttachment
 * 用于表单提交前的数据转换
 *
 * @example
 * const attachments = toAttachments(formData.files);
 */
export function toAttachment(file: IUploadedFile): IAttachment {
  return {
    id: file.id || crypto.randomUUID(),
    name: file.name,
    url: file.url,
    size: file.size || 0,
    mimeType: file.mimeType || file.type || '',
  };
}

/**
 * 将后端 IAttachment 转换为前端 UploadedFile
 * 用于回显编辑表单时的数据转换
 *
 * @example
 * const files = toUploadedFiles(entity.attachments);
 */
export function toUploadedFile(attachment: IAttachment): IUploadedFile {
  return {
    id: attachment.id,
    name: attachment.name,
    url: attachment.url,
    type: attachment.mimeType,
    size: attachment.size,
    mimeType: attachment.mimeType,
  };
}

/**
 * 批量转换：UploadedFile[] → IAttachment[]
 */
export function toAttachments(files: IUploadedFile[]): IAttachment[] {
  return files.map(toAttachment);
}

/**
 * 批量转换：IAttachment[] → UploadedFile[]
 */
export function toUploadedFiles(attachments: IAttachment[]): IUploadedFile[] {
  return attachments.map(toUploadedFile);
}
