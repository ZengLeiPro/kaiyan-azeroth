/**
 * 钉钉日志实体（混合：同步自钉钉 + 本地新增/编辑）
 *
 * - source='dingtalk'：由 dingtalk-sync 模块自动同步
 * - source='local'：用户本地新增（不回写钉钉，钉钉 OAPI 无修改/删除接口）
 * - isLocallyEdited=true：同步过来的日志被本地编辑过，增量同步不再覆盖
 */
export interface IDingtalkLogSection {
  key: string;
  value: string;
}

export interface IDingtalkLog {
  /** 钉钉日志报告 ID（主键）；本地新增的会用 `local-{cuid}` 前缀 */
  reportId: string;
  templateName?: string | null;
  creatorId?: string | null;
  creatorName?: string | null;
  deptName?: string | null;
  /** 钉钉同步过来的纯文本正文（含 \r\n 换行） */
  contents?: string | null;
  /** 结构化正文段，本地新增/编辑主要使用 */
  contentsJson?: IDingtalkLogSection[] | null;
  createTime?: string | null;
  syncedAt?: string | null;
  source?: 'dingtalk' | 'local';
  isLocallyEdited?: boolean;
  updatedAt?: string | null;
}

/**
 * 钉钉日志 API 响应类型
 */

export interface IDingtalkLogResponse extends IDingtalkLog {}

/**
 * 钉钉日志新增载荷
 */
export interface IDingtalkLogCreate {
  templateName?: string | null;
  creatorName?: string | null;
  deptName?: string | null;
  sections: IDingtalkLogSection[];
  createTime?: string;
}

/**
 * 钉钉日志更新载荷
 */
export type IDingtalkLogUpdate = Partial<IDingtalkLogCreate>;
