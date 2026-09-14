/**
 * SEO 同步任务执行记录
 *
 * 每次 seo-sync FC 运行都落一条；失败或部分成功时人可查看 errors 字段定位问题。
 * 由 FC 写入，业务层只读。
 */
export interface ISeoSyncRunError {
  /** 数据源：bing / google / clarity / baidu-tongji */
  source: string;
  /** 阶段：fetch / parse / write / validate */
  stage: string;
  /** 错误信息 */
  message: string;
}

export interface ISeoSyncRunCounts {
  bing?: number;
  google?: number;
  clarity?: number;
  baiduTongji?: number;
}

export interface ISeoSyncRun {
  id: string;
  /** 触发源：timer / http */
  triggerSource: string;
  /** 状态：running / success / partial / failed */
  status: string;
  /** ISO 时间字符串 */
  startedAt: string;
  finishedAt?: string | null;
  /** 总耗时毫秒 */
  elapsedMs?: number | null;
  /** 各源同步成功条数 */
  counts: ISeoSyncRunCounts;
  /** 错误清单 */
  errors: ISeoSyncRunError[];
  /** 完整运行报告（开发调试用） */
  report?: Record<string, unknown> | null;

  createdAt?: string;
  updatedAt?: string;
  deletedAt?: string | null;
  version?: number;
}

export interface ISeoSyncRunResponse extends ISeoSyncRun {}
