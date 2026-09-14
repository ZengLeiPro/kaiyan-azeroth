import { ForbiddenException } from '@nestjs/common';

import type { CurrentUserType } from '../decorators/current-user.decorator';

export const FRESH_JWT_AUTHENTICATION_MAX_AGE_MS = 5 * 60 * 1000;
export const FRESH_JWT_AUTHENTICATION_FUTURE_SKEW_MS = 30 * 1000;

/**
 * 高风险操作的 step-up primitive：只接受最近五分钟内完成认证的 JWT。
 * PAT、缺失/无效 auth_time、超过有限时钟偏差或超过窗口的 JWT 一律 fail-closed。
 */
export function assertFreshJwtAuthentication(
  user: Pick<CurrentUserType, 'authType' | 'authenticatedAt'> | null | undefined,
  now = new Date()
): void {
  if (user?.authType !== 'jwt') {
    throw new ForbiddenException('此操作仅支持 JWT 认证，请重新登录后重试');
  }

  const authenticatedAt = user.authenticatedAt;
  const authenticatedAtMs =
    authenticatedAt instanceof Date ? authenticatedAt.getTime() : Number.NaN;
  const nowMs = now.getTime();
  const ageMs = nowMs - authenticatedAtMs;

  if (
    !Number.isFinite(authenticatedAtMs) ||
    !Number.isFinite(nowMs) ||
    ageMs < -FRESH_JWT_AUTHENTICATION_FUTURE_SKEW_MS ||
    ageMs > FRESH_JWT_AUTHENTICATION_MAX_AGE_MS
  ) {
    throw new ForbiddenException('认证时间无效或已超过 5 分钟，请重新登录后重试');
  }
}
