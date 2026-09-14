import { SetMetadata } from '@nestjs/common';

/**
 * 高风险写操作的 step-up 标记。
 *
 * FreshJwtGuard 只接受最近五分钟内认证的 JWT，PAT 一律拒绝。
 * 本装饰器是 RBAC 的附加条件，不能替代 @RequirePermission。
 */
export const FRESH_JWT_KEY = 'requireFreshJwt';
export const RequireFreshJwt = () => SetMetadata(FRESH_JWT_KEY, true);
