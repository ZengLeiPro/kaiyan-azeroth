/** JSON-compatible values accepted by Xiaohongshu report dimensions and metrics. */
export type XiaohongshuJsonPrimitive = string | number | boolean | null;
export type XiaohongshuJsonValue =
  | XiaohongshuJsonPrimitive
  | XiaohongshuJsonValue[]
  | { [key: string]: XiaohongshuJsonValue };

export interface XiaohongshuApiEnvelope<T> {
  code: number;
  success: boolean;
  msg: string;
  data: T;
  request_id?: string;
}

export interface XiaohongshuApprovalAdvertiser {
  advertiser_id: string | number;
  advertiser_name?: string;
  corporation_name?: string;
  virtual_seller_id?: string;
}

export interface XiaohongshuOAuthData {
  access_token: string;
  access_token_expires_in: number;
  refresh_token: string;
  refresh_token_expires_in: number;
  user_id: string;
  app_id: string | number;
  approval_role_type?: number;
  role_type: number;
  platform_type: number;
  approval_advertisers?: XiaohongshuApprovalAdvertiser[];
  scope?: string;
  corporation_name?: string;
  virtual_seller_id?: string;
  create_time?: number;
  update_time?: number;
}

export type XiaohongshuReportLevel = 'account' | 'campaign' | 'unit' | 'creative' | 'note';

export interface XiaohongshuOfflineReportRequest {
  advertiser_id: string;
  start_date: string;
  end_date: string;
  time_unit?: 'DAY' | 'HOUR' | 'SUMMARY';
  page_num?: number;
  page_size?: number;
  data_caliber?: 0 | 1;
  split_columns?: string[];
  filters?: XiaohongshuJsonValue[];
  [key: string]: XiaohongshuJsonValue | undefined;
}

export interface XiaohongshuReportRow {
  [key: string]: XiaohongshuJsonValue | undefined;
}

export type XiaohongshuNoteType = 1 | 2 | 4 | 6 | 11 | 12 | 14;

export interface XiaohongshuNoteListRequest {
  advertiser_id: string;
  note_type: XiaohongshuNoteType;
  keyword: string;
  page: number;
  page_size: number;
  base_only: boolean;
}

export interface XiaohongshuNote {
  [key: string]: XiaohongshuJsonValue;
}

export interface XiaohongshuNoteListData {
  total: number;
  notes: XiaohongshuNote[];
}

export interface XiaohongshuReportAggregationData {
  [key: string]: XiaohongshuJsonValue | undefined;
}

export interface XiaohongshuOfflineReportData<
  TRow extends XiaohongshuReportRow = XiaohongshuReportRow,
> {
  data_list: TRow[];
  total_count: number;
  aggregation_data?: XiaohongshuReportAggregationData;
}
