export type JwtCredentialTokenType = 'access' | 'refresh';

export interface JwtCredentialClaims {
  sub: string;
  eid: string;
  jti: string;
  iat: number;
  auth_time: number;
  tokenType: JwtCredentialTokenType;
  username?: string;
  roles?: string[];
}

const MAX_FUTURE_SKEW_MS = 30_000;

/**
 * Access 与 refresh 共用的凭据身份/时间声明校验。
 * 旧 token 缺少任一安全声明时 fail closed，要求重新登录。
 */
export function parseJwtCredentialClaims(
  payload: unknown,
  expectedTokenType: JwtCredentialTokenType,
  nowMs = Date.now()
): JwtCredentialClaims | null {
  if (!payload || typeof payload !== 'object') return null;

  const claims = payload as Record<string, unknown>;
  const sub = nonBlankString(claims.sub);
  const eid = nonBlankString(claims.eid);
  const jti = nonBlankString(claims.jti);
  const iat = positiveFiniteNumber(claims.iat);
  const authTime = positiveFiniteNumber(claims.auth_time);

  if (
    claims.tokenType !== expectedTokenType ||
    !sub ||
    !eid ||
    sub !== eid ||
    !jti ||
    iat === null ||
    authTime === null ||
    iat * 1000 > nowMs + MAX_FUTURE_SKEW_MS ||
    authTime * 1000 > nowMs + MAX_FUTURE_SKEW_MS ||
    authTime > iat
  ) {
    return null;
  }

  return {
    sub,
    eid,
    jti,
    iat,
    auth_time: authTime,
    tokenType: expectedTokenType,
    ...(typeof claims.username === 'string' ? { username: claims.username } : {}),
    ...(Array.isArray(claims.roles) && claims.roles.every((role) => typeof role === 'string')
      ? { roles: claims.roles as string[] }
      : {}),
  };
}

function nonBlankString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function positiveFiniteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}
