export interface DingtalkLegacyErrorPayload {
  errcode?: number;
  errmsg?: string;
  subCode?: string;
  subMsg?: string;
  sub_code?: string;
  sub_msg?: string;
}

/**
 * 旧版 OpenAPI 的 errcode=88 只表示鉴权异常，不能直接等同 token 失效。
 * 仅当子错误明确同时指向 access token 和失效语义时，才允许清理本地 token 缓存。
 */
export function isDingtalkTokenInvalidResponse(
  payload: DingtalkLegacyErrorPayload | null | undefined
): boolean {
  if (payload?.errcode !== 88) return false;

  const diagnostic = [payload.subCode, payload.subMsg, payload.sub_code, payload.sub_msg]
    .filter((value): value is string => typeof value === 'string' && value.length > 0)
    .join(' ');
  if (!diagnostic) return false;

  const normalized = diagnostic.replace(/[\s_-]/g, '').toLowerCase();
  const mentionsToken = normalized.includes('accesstoken') || normalized.includes('token');
  const isInvalid = /(invalid|illegal|expired|expire|notvalid|不合法|无效|失效|过期)/iu.test(
    diagnostic
  );
  return mentionsToken && isInvalid;
}
