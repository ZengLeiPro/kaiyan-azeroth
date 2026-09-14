/**
 * 同步状态实体
 */
export interface ISyncState {
  id: string;
  source: string;
  entityName: string;
  stateKey: string;
  stateValue: string;
  updatedAt: string;
}

/**
 * 同步状态 API 响应类型
 */
export interface ISyncStateResponse extends ISyncState {}
