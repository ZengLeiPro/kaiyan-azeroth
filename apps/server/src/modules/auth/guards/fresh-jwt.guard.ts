import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import type { CurrentUserType } from '../decorators/current-user.decorator';
import { FRESH_JWT_KEY } from '../decorators/fresh-jwt.decorator';
import { assertFreshJwtAuthentication } from './fresh-jwt-authentication';

/**
 * 高风险操作 step-up：只校验最近五分钟内的 JWT。
 * 不比较员工 UUID，也不绕过 RBAC。
 */
@Injectable()
export class FreshJwtGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<boolean>(FRESH_JWT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required) return true;

    const user = context.switchToHttp().getRequest().user as CurrentUserType | undefined;
    assertFreshJwtAuthentication(user);
    return true;
  }
}
