/**
 * 上传模块类型定义
 */

/**
 * 单文件上传结果（后端返回）
 */
export interface IUploadResult {
  /** 文件资产 ID */
  id: string;
  /** 文件访问 URL */
  url: string;
  /** 当前登录员工的短时下载地址 */
  downloadUrl: string;
  /** 存储文件名（后端生成的唯一文件名） */
  filename: string;
  /** 原始文件名 */
  originalName: string;
  /** 文件大小（字节） */
  size: number;
  /** MIME 类型 */
  mimeType: string;
}

/**
 * 已登记的上传文件资产。
 *
 * 该类型只描述存储身份与上传人；业务读取权限仍由引用附件的业务对象决定。
 */
export interface IFileAsset {
  id: string;
  storageKey: string;
  originalName: string;
  size: number;
  mimeType: string;
  ownerEmployeeId: string;
  createdAt: string;
}
