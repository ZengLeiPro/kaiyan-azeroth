import { ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';

import { PrismaService } from '../../../common/prisma/prisma.service';
import { extractClientIp } from '../../../common/utils/client-ip.helper';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { PatService } from '../services/pat.service';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(
    private reflector: Reflector,
    private readonly patService: PatService,
    private readonly prisma: PrismaService
  ) {
    super();
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    // PAT 分支：Authorization: Bearer pat_xxx 走 DB 校验，避开 JWT strategy
    const request = context.switchToHttp().getRequest();
    const authHeader: string | undefined = request.headers?.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.slice('Bearer '.length).trim();
      if (this.patService.isPatToken(token)) {
        const ip = extractClientIp(request);
        const verifyResult = await this.patService.verify(token, ip);
        if (!verifyResult) {
          throw new UnauthorizedException('无效或已吊销的访问令牌');
        }

        // push 6: PAT 直接挂到 employee 上（user 表已删）
        const employee = await this.prisma.employee.findUnique({
          where: { id: verifyResult.employeeId },
          select: {
            id: true,
            username: true,
            loginStatus: true,
            canLogin: true,
            deletedAt: true,
            dingtalkUserId: true,
            userRoles: {
              where: { role: { deletedAt: null, status: 'active' } },
              select: { role: { select: { code: true } } },
            },
          },
        });
        if (
          !employee ||
          employee.deletedAt ||
          employee.loginStatus !== 'active' ||
          !employee.canLogin
        ) {
          throw new UnauthorizedException('令牌对应的员工已停用');
        }
        // PAT token 不受 tokenInvalidAfter 影响（PAT 是长期凭证，单独管理 revokedAt）
        request.user = {
          id: employee.id,
          username: employee.username ?? '',
          roles: employee.userRoles.map((r) => r.role.code),
          employeeId: employee.id,
          dingtalkUserId: employee.dingtalkUserId ?? undefined,
          authType: 'pat' as const,
          patId: verifyResult.patId,
        };
        return true;
      }
    }

    return (await super.canActivate(context)) as boolean;
  }
}
