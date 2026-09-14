import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';

import { PrismaService } from '../../../common/prisma/prisma.service';
import { parseJwtCredentialClaims } from '../jwt-credential-claims';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    private readonly prisma: PrismaService,
    configService: ConfigService
  ) {
    const secret = configService.get<string>('JWT_SECRET');
    if (!secret) throw new Error('JWT_SECRET environment variable is required');
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: secret,
    });
  }

  async validate(payload: unknown) {
    const claims = parseJwtCredentialClaims(payload, 'access');
    if (!claims) {
      // 缺安全 claims 的历史 access token 明确强制重登，不再兼容无 Session 的无状态 token。
      throw new UnauthorizedException('无效的访问令牌');
    }
    const employeeId = claims.sub;

    // 安全状态、Session 与授权角色必须逐请求读共享 DB，禁止进入进程本地缓存。
    const employee = await this.prisma.employee.findUnique({
      where: { id: employeeId },
      select: {
        id: true,
        username: true,
        loginStatus: true,
        canLogin: true,
        deletedAt: true,
        dingtalkUserId: true,
        tokenInvalidAfter: true,
      },
    });
    if (
      !employee ||
      employee.deletedAt ||
      employee.loginStatus !== 'active' ||
      !employee.canLogin
    ) {
      throw new UnauthorizedException('无效的令牌');
    }
    if (employee.tokenInvalidAfter && claims.iat * 1000 <= employee.tokenInvalidAfter.getTime()) {
      throw new UnauthorizedException('令牌已被强制失效，请重新登录');
    }

    const session = await this.prisma.session.findUnique({
      where: { id: claims.jti },
      select: { employeeId: true, expiresAt: true },
    });
    if (!session || session.employeeId !== employeeId || session.expiresAt <= new Date()) {
      throw new UnauthorizedException('会话已失效，请重新登录');
    }

    const roles = await this.prisma.userRole.findMany({
      where: {
        employeeId,
        role: { deletedAt: null, status: 'active' },
      },
      select: { role: { select: { code: true } } },
    });
    const roleCodes = roles.map((item) => item.role.code);

    return {
      id: employee.id,
      username: employee.username ?? '',
      roles: roleCodes,
      employeeId: employee.id,
      dingtalkUserId: employee.dingtalkUserId ?? undefined,
      sessionId: claims.jti,
      authType: 'jwt' as const,
      authenticatedAt: new Date(claims.auth_time * 1000),
    };
  }
}
