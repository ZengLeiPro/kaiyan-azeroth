import { z } from 'zod';

/**
 * 上传结果 schema
 *
 * 对应后端 UploadService.uploadFile() 的返回值
 */
export const uploadResultSchema = z.object({
  /** 文件资产 ID */
  id: z.string().uuid(),
  /** 文件访问 URL */
  url: z.string().url(),
  /** 当前员工的短时下载地址 */
  downloadUrl: z.string().startsWith('/'),
  /** 存储文件名（后端生成的唯一文件名） */
  filename: z.string(),
  /** 原始文件名 */
  originalName: z.string(),
  /** 文件大小（字节） */
  size: z.number().int().positive(),
  /** MIME 类型 */
  mimeType: z.string(),
});

export type UploadResult = z.infer<typeof uploadResultSchema>;
