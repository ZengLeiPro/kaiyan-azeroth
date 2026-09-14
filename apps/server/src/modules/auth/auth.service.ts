import {
  ForbiddenException,
  forwardRef,
  Inject,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Prisma } from '@prisma/client';
import axios from 'axios';
import * as bcrypt from 'bcryptjs';
import Bowser from 'bowser';
import { randomUUID } from 'crypto';

import { PrismaService } from '../../common/prisma/prisma.service';
import {
  authCacheKeysFor,
  EmployeePermissionCacheService,
  meCacheKey,
  scopeCacheKeyPrefixFor,
} from '../../common/services/employee-permission-cache.service';
import { DingtalkAuth } from '../dingtalk-core/dingtalk-auth.service';
import { isDingtalkTokenInvalidResponse } from '../dingtalk-core/dingtalk-errors';
import { DingtalkHttp } from '../dingtalk-core/dingtalk-http';
import { lockEmployeeLoginIdentifiers } from '../employees/employee-login-identifier';
import { SessionsService } from '../sessions/sessions.service';
import { DingtalkLoginDto } from './dto/dingtalk-login.dto';
import { LoginDto } from './dto/login.dto';
import { parseJwtCredentialClaims } from './jwt-credential-claims';

/** 连续登录失败后锁定账号的阈值 */
export const LOGIN_FAIL_LOCK_THRESHOLD = 5;
/** 锁定时长（分钟） */
const LOGIN_LOCK_DURATION_MINUTES = 30;
const DEFAULT_DINGTALK_OAPI_BASE_URL = 'https://oapi.dingtalk.com';
const DEFAULT_DINGTALK_API_BASE_URL = 'https://api.dingtalk.com';

type DingtalkInAppUserInfoResponse = {
  errcode?: number;
  errmsg?: string;
  subCode?: string;
  subMsg?: string;
  sub_code?: string;
  sub_msg?: string;
  result?: {
    userid?: string;
    unionid?: string;
    device_id?: string;
    name?: string;
    sys_level?: number;
  };
};

type DingtalkUserAccessTokenResponse = {
  accessToken?: string;
  refreshToken?: string;
  expireIn?: number;
  corpId?: string;
};

type DingtalkContactMeResponse = {
  nick?: string;
  unionId?: string;
  userId?: string;
  dingtalkUserId?: string;
  openId?: string;
  mobile?: string;
  avatarUrl?: string;
  email?: string;
  stateCode?: string;
};

type DingtalkApiErrorResponse = {
  requestid?: string;
  code?: string;
  message?: string;
  errcode?: number;
  errmsg?: string;
};

type EmployeeForAuth = {
  id: string;
  username: string | null;
  name: string;
  phone: string | null;
  email: string | null;
  avatar: string | null;
  password: string | null;
  loginStatus: string;
  canLogin: boolean;
  deletedAt: Date | null;
  tokenInvalidAfter: Date | null;
  loginFailCount: number;
  lockUntil: Date | null;
  dingtalkUserId: string | null;
  dingtalkUnionId: string | null;
  userRoles: Array<{
    role: {
      id: string;
      code: string;
      name: string;
      permissions: Array<{
        module: string;
        menu: string;
        view: boolean;
        create: boolean;
        edit: boolean;
        delete: boolean;
        export: boolean;
        approve: boolean;
        viewScope: string;
      }>;
    };
  }>;
};

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly dingtalkOapi: DingtalkHttp;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly cache: EmployeePermissionCacheService,
    private readonly dingtalkAuth: DingtalkAuth,
    @Inject(forwardRef(() => SessionsService))
    private readonly sessionsService: SessionsService
  ) {
    this.dingtalkOapi = new DingtalkHttp({
      baseUrl:
        this.configService.get<string>('DINGTALK_OAPI_BASE_URL') ?? DEFAULT_DINGTALK_OAPI_BASE_URL,
      timeout: 30,
      maxRetries: 3,
      qps: 30,
    });
  }

  /** 失效一个 employee 的 auth 链路缓存(getMe / jwt.strategy 都清) */
  invalidateAuthCache(employeeId: string): void {
    this.cache.invalidateMany(authCacheKeysFor(employeeId));
    // viewScope 缓存按 (employee, module, menu) 三段,按前缀一并清空
    this.cache.invalidateByPrefix(scopeCacheKeyPrefixFor(employeeId));
  }

  /**
   * 记录登录失败日志
   */
  private async logLoginFailure(
    employeeId: string | null,
    username: string,
    ip: string,
    userAgent: string | null,
    failReason: string,
    tx?: Prisma.TransactionClient
  ) {
    await (tx ?? this.prisma).loginLog.create({
      data: {
        employeeId,
        username,
        actionType: 'login',
        ip,
        userAgent,
        status: 'fail',
        failReason,
      },
    });
  }

  /**
   * 钉钉免登/扫码登录。OAuth/API 返回的 userId + unionId 是不可拆分的同一证明 pair。
   */
  async dingtalkLogin(loginDto: DingtalkLoginDto, ip?: string, userAgent?: string) {
    const safeIp = ip || 'unknown';
    const safeUa = userAgent || null;
    const source = loginDto.source ?? 'in_app';
    const dingtalkUser =
      source === 'web'
        ? await this.getDingtalkWebLoginUser(loginDto.code)
        : await this.getDingtalkInAppLoginUser(loginDto.code);

    const outcome = await this.prisma.$transaction(async (tx) => {
      await this.lockDingtalkLoginIdentityPair(tx, dingtalkUser);

      const fail = async (
        employeeId: string | null,
        username: string,
        message: string,
        reason: string
      ) => {
        await this.logLoginFailure(employeeId, username, safeIp, safeUa, reason, tx);
        return { ok: false as const, message };
      };

      const identityInclude = {
        userRoles: {
          where: { role: { deletedAt: null, status: 'active' } },
          include: {
            role: {
              include: {
                permissions: true,
              },
            },
          },
        },
      } satisfies Prisma.EmployeeInclude;

      // 先在全 Employee（含软删/停用）分别解析两把身份键；共享键必须 fail-closed。
      const [userIdMatches, unionIdMatches] = await Promise.all([
        tx.employee.findMany({
          where: { dingtalkUserId: dingtalkUser.userId },
          select: {
            id: true,
            dingtalkUserId: true,
            dingtalkUnionId: true,
            dingtalkActive: true,
            deletedAt: true,
          },
          take: 2,
        }),
        tx.employee.findMany({
          where: { dingtalkUnionId: dingtalkUser.unionId },
          select: {
            id: true,
            dingtalkUserId: true,
            dingtalkUnionId: true,
            dingtalkActive: true,
            deletedAt: true,
          },
          take: 2,
        }),
      ]);

      const userIdEmployee = userIdMatches.length === 1 ? userIdMatches[0] : null;
      const unionIdEmployee = unionIdMatches.length === 1 ? unionIdMatches[0] : null;
      const matchedEmployee =
        userIdEmployee &&
        unionIdEmployee &&
        userIdEmployee.id === unionIdEmployee.id &&
        userIdEmployee.dingtalkActive &&
        !userIdEmployee.deletedAt &&
        userIdEmployee.dingtalkUserId === dingtalkUser.userId &&
        userIdEmployee.dingtalkUnionId === dingtalkUser.unionId
          ? userIdEmployee
          : null;

      if (!matchedEmployee) {
        return fail(
          null,
          `dingtalk:${dingtalkUser.userId}`,
          '钉钉身份未唯一绑定同一员工账号',
          '钉钉身份 pair 缺失、冲突或未绑定同一员工'
        );
      }

      const locked = await this.sessionsService.lockEmployeeForCredentials(tx, matchedEmployee.id);
      const employee = locked
        ? await tx.employee.findUnique({
            where: { id: matchedEmployee.id },
            include: identityInclude,
          })
        : null;
      if (
        !employee ||
        employee.deletedAt ||
        !employee.dingtalkActive ||
        employee.dingtalkUserId !== dingtalkUser.userId ||
        employee.dingtalkUnionId !== dingtalkUser.unionId
      ) {
        return fail(
          employee?.id ?? null,
          employee?.username ?? employee?.name ?? `dingtalk:${dingtalkUser.userId}`,
          '钉钉身份未唯一绑定同一员工账号',
          '钉钉身份在锁后失效或不再匹配'
        );
      }

      if (!employee.canLogin) {
        return fail(
          employee.id,
          employee.username ?? employee.name,
          '账号未开通登录权限',
          '账号未开通登录权限'
        );
      }

      if (employee.loginStatus !== 'active') {
        return fail(employee.id, employee.username ?? employee.name, '账号未启用', '账号未启用');
      }

      // 身份锁持有到登录凭证创建完成；并发解绑随后取得锁并吊销本次凭证。
      const result = await this.issueLoginResult(
        employee,
        employee.username ?? employee.name,
        false,
        safeIp,
        safeUa,
        tx
      );
      return {
        ok: true as const,
        value: result,
        employeeName: employee.username ?? employee.name,
      };
    });

    if (!outcome.ok) {
      // 失败日志在事务内提交后再对调用方抛 401，避免因 throw 回滚审计。
      throw new UnauthorizedException(outcome.message);
    }

    this.logger.log(
      `员工 ${outcome.employeeName} 通过钉钉${source === 'web' ? '扫码' : '免登'}登录成功`
    );
    return outcome.value;
  }

  private async lockDingtalkLoginIdentityPair(
    tx: Prisma.TransactionClient,
    identity: { userId: string; unionId: string }
  ): Promise<void> {
    const lockKeys = [
      `employee_dingtalk:user:${identity.userId}`,
      `employee_dingtalk:union:${identity.unionId}`,
    ].sort();

    for (const lockKey of lockKeys) {
      // @prisma-raw-sql: 与 Employee bind/unbind 共用固定序 transaction advisory lock，避免 SSO 读到换绑中间态。
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`;
    }
  }

  /**
   * 用户登录（push 6: 直接查 employee 表）
   */
  async login(loginDto: LoginDto, ip?: string, userAgent?: string) {
    const { username, password, rememberMe } = loginDto;
    const safeIp = ip || 'unknown';
    const safeUa = userAgent || null;

    // 仅用于定位待锁定的 Employee；跨 username/phone 最多取 2 个主体，歧义时禁止任选其一。
    const candidates = await this.prisma.employee.findMany({
      where: {
        OR: [{ username }, { phone: username }],
        deletedAt: null,
      },
      select: { id: true },
      take: 2,
    });

    if (candidates.length !== 1) {
      await this.logLoginFailure(
        null,
        username,
        safeIp,
        safeUa,
        candidates.length === 0 ? '用户不存在' : '登录标识匹配多个员工'
      );
      throw new UnauthorizedException('用户名或密码错误');
    }
    const candidate = candidates[0]!;

    const outcome = await this.prisma.$transaction(async (tx) => {
      const locked = await this.sessionsService.lockEmployeeForCredentials(tx, candidate.id);
      // 与 writer 保持 Employee → identifier 的固定锁序，避免同值更新与登录形成反向等待。
      await lockEmployeeLoginIdentifiers(tx, [username]);
      const employee = locked
        ? await tx.employee.findUnique({
            where: { id: candidate.id },
            include: {
              userRoles: {
                where: { role: { deletedAt: null, status: 'active' } },
                include: { role: { include: { permissions: true } } },
              },
            },
          })
        : null;

      const fail = async (
        message: string,
        reason: string,
        failureEmployeeId: string | null = employee?.id ?? null
      ) => {
        await this.logLoginFailure(failureEmployeeId, username, safeIp, safeUa, reason, tx);
        return { ok: false as const, message, employeeId: failureEmployeeId };
      };

      if (!employee || employee.deletedAt || !employee.password) {
        return fail('用户名或密码错误', '用户不存在', null);
      }

      // 候选读取后可能已改名；行锁后必须按当前值重验，并把软删历史也纳入唯一主体语义。
      const currentMatchesInput = employee.username === username || employee.phone === username;
      const identityOwners = currentMatchesInput
        ? await tx.employee.findMany({
            where: { OR: [{ username }, { phone: username }] },
            select: { id: true },
            take: 2,
          })
        : [];
      if (
        !currentMatchesInput ||
        identityOwners.length !== 1 ||
        identityOwners[0]?.id !== employee.id
      ) {
        return fail('用户名或密码错误', '登录标识已变更或匹配多个员工', null);
      }
      if (!employee.canLogin) {
        return fail('账号未开通登录权限', '账号未开通登录权限');
      }
      if (employee.loginStatus === 'disabled') {
        return fail('账号已被禁用', '账号已被禁用');
      }

      const now = new Date();
      if (employee.lockUntil && employee.lockUntil > now) {
        const remainMinutes = Math.ceil((employee.lockUntil.getTime() - now.getTime()) / 60000);
        return fail(
          `账号已被锁定，请${remainMinutes}分钟后重试`,
          `账号已锁定，剩余${remainMinutes}分钟`
        );
      }

      // 过期锁在同一行锁事务内自动解除，随后按当前密码继续认证。
      if (employee.loginStatus === 'locked') {
        await tx.employee.update({
          where: { id: employee.id },
          data: { loginStatus: 'active', loginFailCount: 0, lockUntil: null },
        });
        employee.loginStatus = 'active';
        employee.loginFailCount = 0;
        employee.lockUntil = null;
      } else if (employee.loginStatus !== 'active') {
        return fail('账号已被锁定', '账号已被锁定');
      }

      if (!(await bcrypt.compare(password, employee.password))) {
        // Employee 行锁内原子 +1；阈值锁定、凭据撤销和失败日志共享同一事务。
        const updated = await tx.employee.update({
          where: { id: employee.id },
          data: { loginFailCount: { increment: 1 } },
          select: { loginFailCount: true },
        });
        const newCount = updated.loginFailCount;
        let revokedSessions = 0;

        if (newCount >= LOGIN_FAIL_LOCK_THRESHOLD) {
          await tx.employee.update({
            where: { id: employee.id },
            data: {
              lockUntil: new Date(now.getTime() + LOGIN_LOCK_DURATION_MINUTES * 60 * 1000),
              loginStatus: 'locked',
            },
          });
          const revocation = await this.sessionsService.revokeInteractiveCredentialsInTransaction(
            tx,
            employee.id,
            employee.tokenInvalidAfter
          );
          revokedSessions = revocation.revokedSessions;
        }

        await this.logLoginFailure(
          employee.id,
          username,
          safeIp,
          safeUa,
          newCount >= LOGIN_FAIL_LOCK_THRESHOLD
            ? `密码错误(第${newCount}次)，账号已锁定`
            : `密码错误(第${newCount}次)`,
          tx
        );
        return {
          ok: false as const,
          message: '用户名或密码错误',
          employeeId: employee.id,
          newCount,
          revokedSessions,
        };
      }

      if (employee.loginFailCount > 0 || employee.lockUntil) {
        await tx.employee.update({
          where: { id: employee.id },
          data: { loginFailCount: 0, lockUntil: null },
        });
      }

      const value = await this.issueLoginResult(
        employee,
        employee.username ?? username,
        Boolean(rememberMe),
        safeIp,
        safeUa,
        tx
      );
      return { ok: true as const, value, employeeId: employee.id };
    });

    if (!outcome.ok) {
      if (outcome.employeeId) this.invalidateAuthCache(outcome.employeeId);
      if ('newCount' in outcome && outcome.newCount >= LOGIN_FAIL_LOCK_THRESHOLD) {
        this.logger.warn(
          `用户 ${username} 连续 ${outcome.newCount} 次密码错误，已锁定 ${LOGIN_LOCK_DURATION_MINUTES} 分钟；` +
            `撤销 ${outcome.revokedSessions} 个交互式会话`
        );
      }
      // 结果哨兵让失败状态和 loginLog 先提交，再对调用方抛 401。
      throw new UnauthorizedException(outcome.message);
    }

    this.logger.log(`用户 ${username} 登录成功`);
    return outcome.value;
  }

  private async issueLoginResult(
    employee: EmployeeForAuth,
    username: string,
    rememberMe: boolean,
    ip: string,
    userAgent: string | null,
    tx: Prisma.TransactionClient
  ) {
    const accessExpiresIn = rememberMe
      ? '7d'
      : this.configService.get<string>('JWT_ACCESS_EXPIRES_IN', '2h');
    const refreshExpiresIn = rememberMe
      ? '30d'
      : this.configService.get<string>('JWT_REFRESH_EXPIRES_IN', '7d');

    const sessionId = randomUUID();
    const authenticatedAt = new Date();
    const tokens = await this.generateTokens(
      employee.id,
      username,
      employee.userRoles.map((r) => r.role.code),
      sessionId,
      employee.tokenInvalidAfter,
      authenticatedAt,
      accessExpiresIn,
      refreshExpiresIn
    );

    const deviceInfo = this.parseUserAgent(userAgent ?? undefined);
    const expiresAt = this.calculateExpiresAt(refreshExpiresIn);

    await this.sessionsService.createSession(
      {
        employeeId: employee.id,
        deviceType: deviceInfo.deviceType,
        deviceName: deviceInfo.deviceName,
        browser: deviceInfo.browser,
        os: deviceInfo.os,
        ipAddress: ip,
        refreshToken: tokens.refreshToken,
        expiresAt,
        loginTime: authenticatedAt,
      },
      sessionId,
      tx
    );

    await tx.employee.update({
      where: { id: employee.id },
      data: {
        lastLoginAt: new Date(),
        lastLoginIp: ip,
      },
    });
    this.invalidateAuthCache(employee.id);

    await tx.loginLog.create({
      data: {
        employeeId: employee.id,
        username,
        actionType: 'login',
        ip,
        userAgent,
        status: 'success',
      },
    });

    return {
      ...tokens,
      user: this.buildAuthUser(employee, username),
    };
  }

  private buildAuthUser(employee: EmployeeForAuth, username: string) {
    return {
      id: employee.id,
      username,
      phone: employee.phone,
      email: employee.email,
      avatar: employee.avatar,
      status: employee.loginStatus,
      roles: employee.userRoles.map((r) => ({
        id: r.role.id,
        code: r.role.code,
        name: r.role.name,
        permissions: r.role.permissions.map((p) => ({
          module: p.module,
          menu: p.menu,
          view: p.view,
          create: p.create,
          edit: p.edit,
          delete: p.delete,
          export: p.export,
          approve: p.approve,
          viewScope: (p.viewScope === 'ALL' ? 'ALL' : 'SELF') as 'SELF' | 'ALL',
        })),
      })),
      employee: {
        id: employee.id,
        name: employee.name,
      },
    };
  }

  private async getDingtalkInAppLoginUser(code: string) {
    const accessToken = await this.dingtalkAuth.getAccessToken();
    const data = await this.dingtalkOapi.post<DingtalkInAppUserInfoResponse>(
      '/topapi/v2/user/getuserinfo',
      { code },
      { params: { access_token: accessToken } }
    );

    if ((data.errcode ?? 0) !== 0) {
      if (isDingtalkTokenInvalidResponse(data)) this.dingtalkAuth.invalidate();
      throw new UnauthorizedException(
        `钉钉免登失败：${data.subMsg ?? data.sub_msg ?? data.errmsg ?? data.errcode}`
      );
    }

    const userId = data.result?.userid?.trim();
    const unionId = data.result?.unionid?.trim();
    if (!userId || !unionId) {
      throw new UnauthorizedException('钉钉免登失败：未返回完整用户身份 pair');
    }

    return { userId, unionId };
  }

  private async getDingtalkWebLoginUser(code: string) {
    const apiBaseUrl =
      this.configService.get<string>('DINGTALK_API_BASE_URL') ?? DEFAULT_DINGTALK_API_BASE_URL;
    const webClientId = this.configService.get<string>('DINGTALK_WEB_CLIENT_ID');
    const clientId =
      webClientId ||
      this.configService.get<string>('DINGTALK_APP_ID') ||
      this.configService.get<string>('DINGTALK_CLIENT_ID');
    const webClientSecret = this.configService.get<string>('DINGTALK_WEB_CLIENT_SECRET');
    const clientSecret = webClientId
      ? webClientSecret
      : webClientSecret || this.configService.get<string>('DINGTALK_CLIENT_SECRET');
    if (!clientId || !clientSecret) throw new UnauthorizedException('钉钉登录配置缺失');

    const tokenResponse = await this.requestDingtalkUserAccessToken(apiBaseUrl, {
      clientId,
      clientSecret,
      code,
    });

    const userAccessToken = tokenResponse.data.accessToken;
    if (!userAccessToken) throw new UnauthorizedException('钉钉扫码登录失败：未返回用户授权令牌');

    const meResponse = await this.requestDingtalkContactMe(apiBaseUrl, userAccessToken);

    const userId = (meResponse.data.dingtalkUserId ?? meResponse.data.userId)?.trim();
    const unionId = meResponse.data.unionId?.trim();
    if (!userId || !unionId) {
      throw new UnauthorizedException('钉钉扫码登录失败：未返回完整用户身份 pair');
    }

    return { userId, unionId };
  }

  private async requestDingtalkUserAccessToken(
    apiBaseUrl: string,
    params: { clientId: string; clientSecret: string; code: string }
  ) {
    try {
      return await axios.post<DingtalkUserAccessTokenResponse>(
        `${apiBaseUrl}/v1.0/oauth2/userAccessToken`,
        {
          clientId: params.clientId,
          clientSecret: params.clientSecret,
          code: params.code,
          grantType: 'authorization_code',
        },
        { timeout: 30000 }
      );
    } catch (error) {
      throw this.toDingtalkLoginException(error, '钉钉扫码登录失败：获取用户授权令牌失败');
    }
  }

  private async requestDingtalkContactMe(apiBaseUrl: string, userAccessToken: string) {
    try {
      return await axios.get<DingtalkContactMeResponse>(`${apiBaseUrl}/v1.0/contact/users/me`, {
        headers: { 'x-acs-dingtalk-access-token': userAccessToken },
        timeout: 30000,
      });
    } catch (error) {
      throw this.toDingtalkLoginException(error, '钉钉扫码登录失败：获取用户信息失败');
    }
  }

  private toDingtalkLoginException(error: unknown, fallbackMessage: string) {
    if (!axios.isAxiosError<DingtalkApiErrorResponse>(error)) {
      return new UnauthorizedException(fallbackMessage);
    }

    const data = error.response?.data;
    const status = error.response?.status;
    const requestId = data?.requestid;
    const code = data?.code ?? data?.errcode;
    const message = data?.message ?? data?.errmsg;
    this.logger.warn(
      `DingTalk web login API failed: status=${status ?? 'unknown'}, code=${
        code ?? 'unknown'
      }, requestId=${requestId ?? 'unknown'}, message=${message ?? fallbackMessage}`
    );

    return new UnauthorizedException(message ? `钉钉扫码登录失败：${message}` : fallbackMessage);
  }

  /**
   * 获取当前登录用户最新信息（用于前端启动时 hydrate）
   * 数据源直读 employees 表，避免 localStorage 缓存陈旧字段（如 avatar 后同步进来）
   *
   * 走 EmployeePermissionCacheService 进程内缓存(TTL 5min),减少三层 include 高频压库。
   * 任何 employee/userRole/role 写路径必须主动调 invalidateAuthCache(employeeId) 让缓存失效。
   */
  async getMe(employeeId: string) {
    const cacheKey = meCacheKey(employeeId);
    type GetMeResult = Awaited<ReturnType<AuthService['fetchMeFromDb']>>;
    const cached = this.cache.get<GetMeResult>(cacheKey);
    if (cached) {
      return cached;
    }

    const fresh = await this.fetchMeFromDb(employeeId);
    this.cache.set(cacheKey, fresh);
    return fresh;
  }

  private async fetchMeFromDb(employeeId: string) {
    const employee = await this.prisma.employee.findUnique({
      where: { id: employeeId },
      include: {
        userRoles: {
          where: { role: { deletedAt: null, status: 'active' } },
          include: {
            role: {
              include: {
                permissions: true,
              },
            },
          },
        },
      },
    });

    if (!employee || employee.deletedAt) {
      throw new UnauthorizedException('用户不存在或已被删除');
    }

    return {
      id: employee.id,
      username: employee.username ?? '',
      phone: employee.phone,
      email: employee.email,
      avatar: employee.avatar,
      status: employee.loginStatus,
      roles: employee.userRoles.map((r) => ({
        id: r.role.id,
        code: r.role.code,
        name: r.role.name,
        permissions: r.role.permissions.map((p) => ({
          module: p.module,
          menu: p.menu,
          view: p.view,
          create: p.create,
          edit: p.edit,
          delete: p.delete,
          export: p.export,
          approve: p.approve,
          // DB schema 为 String, 实际取值受 enum 守护; 此处显式收窄到 ViewScope
          viewScope: (p.viewScope === 'ALL' ? 'ALL' : 'SELF') as 'SELF' | 'ALL',
        })),
      })),
      employee: {
        id: employee.id,
        name: employee.name,
      },
    };
  }

  /**
   * 高风险操作前重新认证当前 JWT 会话。
   * 验证当前密码后更新 Session.loginTime，并原子轮换 access/refresh token。
   */
  async reauthenticate(
    employeeId: string,
    sessionId: string | undefined,
    password: string,
    ip?: string,
    userAgent?: string
  ) {
    if (!sessionId) throw new UnauthorizedException('重新认证失败');

    const safeIp = (ip || 'unknown').slice(0, 50);
    const safeUa = userAgent?.slice(0, 500) || null;
    const outcome = await this.prisma.$transaction(async (tx) => {
      const lockedEmployee = await this.sessionsService.lockEmployeeForCredentials(tx, employeeId);
      const sessionLocked = lockedEmployee
        ? await this.sessionsService.lockSessionForRefresh(tx, sessionId)
        : false;
      if (!lockedEmployee || !sessionLocked) {
        await tx.loginLog.create({
          data: {
            employeeId: lockedEmployee ? employeeId : undefined,
            username: employeeId,
            actionType: 'reauth',
            ip: safeIp,
            userAgent: safeUa,
            status: 'fail',
            failReason: '当前会话不存在或已失效',
          },
        });
        return { ok: false as const, kind: 'invalid' as const };
      }

      const [employee, session] = await Promise.all([
        tx.employee.findUnique({
          where: { id: employeeId },
          include: {
            userRoles: {
              where: { role: { deletedAt: null, status: 'active' } },
              include: { role: { include: { permissions: true } } },
            },
          },
        }),
        tx.session.findUnique({ where: { id: sessionId } }),
      ]);

      if (
        !employee ||
        !employee.password ||
        employee.deletedAt ||
        employee.loginStatus !== 'active' ||
        !employee.canLogin ||
        !session ||
        session.employeeId !== employeeId ||
        session.expiresAt <= new Date()
      ) {
        await tx.loginLog.create({
          data: {
            employeeId: employee?.id,
            username: employee?.username ?? employeeId,
            actionType: 'reauth',
            ip: safeIp,
            userAgent: safeUa,
            status: 'fail',
            failReason: '当前会话或账号状态无效',
          },
        });
        return { ok: false as const, kind: 'invalid' as const };
      }
      if (!(await bcrypt.compare(password, employee.password))) {
        const now = new Date();
        const updated = await tx.employee.update({
          where: { id: employee.id },
          data: { loginFailCount: { increment: 1 } },
          select: { loginFailCount: true },
        });
        let revokedSessions = 0;
        if (updated.loginFailCount >= LOGIN_FAIL_LOCK_THRESHOLD) {
          await tx.employee.update({
            where: { id: employee.id },
            data: {
              loginStatus: 'locked',
              lockUntil: new Date(now.getTime() + LOGIN_LOCK_DURATION_MINUTES * 60 * 1000),
            },
          });
          const revocation = await this.sessionsService.revokeInteractiveCredentialsInTransaction(
            tx,
            employee.id,
            employee.tokenInvalidAfter
          );
          revokedSessions = revocation.revokedSessions;
        }
        await tx.loginLog.create({
          data: {
            employeeId: employee.id,
            username: employee.username ?? employee.id,
            actionType: 'reauth',
            ip: safeIp,
            userAgent: safeUa,
            status: 'fail',
            failReason:
              updated.loginFailCount >= LOGIN_FAIL_LOCK_THRESHOLD
                ? `密码错误(第${updated.loginFailCount}次)，账号已锁定`
                : `密码错误(第${updated.loginFailCount}次)`,
          },
        });
        return {
          ok: false as const,
          kind: 'password' as const,
          newCount: updated.loginFailCount,
          revokedSessions,
        };
      }

      const authenticatedAt = new Date();
      const refreshExpiresIn = this.configService.get<string>('JWT_REFRESH_EXPIRES_IN', '7d');
      const tokens = await this.generateTokens(
        employee.id,
        employee.username ?? '',
        employee.userRoles.map((item) => item.role.code),
        session.id,
        employee.tokenInvalidAfter,
        authenticatedAt
      );
      const rotated = await tx.session.updateMany({
        where: { id: session.id, employeeId },
        data: {
          refreshToken: this.sessionsService.hashToken(tokens.refreshToken),
          loginTime: authenticatedAt,
          expiresAt: this.calculateExpiresAt(refreshExpiresIn),
          lastActiveTime: authenticatedAt,
        },
      });
      if (rotated.count !== 1) throw new UnauthorizedException('重新认证失败');

      if (employee.loginFailCount > 0 || employee.lockUntil) {
        await tx.employee.update({
          where: { id: employee.id },
          data: { loginFailCount: 0, lockUntil: null },
        });
      }
      await tx.loginLog.create({
        data: {
          employeeId: employee.id,
          username: employee.username ?? employee.id,
          actionType: 'reauth',
          ip: safeIp,
          userAgent: safeUa,
          status: 'success',
        },
      });

      return {
        ok: true as const,
        value: {
          accessToken: tokens.accessToken,
          refreshToken: tokens.refreshToken,
          expiresIn: tokens.expiresIn,
          user: this.buildAuthUser(employee, employee.username ?? ''),
        },
      };
    });

    if (!outcome.ok) {
      this.invalidateAuthCache(employeeId);
      if (outcome.kind === 'password') {
        if (outcome.newCount >= LOGIN_FAIL_LOCK_THRESHOLD) {
          this.logger.warn(
            `用户 ${employeeId} 重新认证连续 ${outcome.newCount} 次失败，已锁定；` +
              `撤销 ${outcome.revokedSessions} 个交互式会话`
          );
        }
        throw new ForbiddenException('当前密码错误');
      }
      throw new UnauthorizedException('重新认证失败');
    }

    return outcome.value;
  }

  /**
   * 刷新令牌（含 Token 轮换）
   */
  async refreshToken(oldRefreshToken: string) {
    try {
      const refreshSecret = this.configService.getOrThrow<string>('JWT_REFRESH_SECRET');
      const payload = this.jwtService.verify(oldRefreshToken, { secret: refreshSecret });
      const claims = parseJwtCredentialClaims(payload, 'refresh');
      if (!claims) throw new UnauthorizedException('无效的刷新令牌');

      const employeeId = claims.sub;

      return await this.prisma.$transaction(async (tx) => {
        // 固定锁序：Employee -> Session。撤销只需 Employee 锁，因此不会与 refresh 死锁。
        const lockedEmployee = await this.sessionsService.lockEmployeeForCredentials(
          tx,
          employeeId
        );
        if (!lockedEmployee) throw new UnauthorizedException('无效的刷新令牌');
        if (!(await this.sessionsService.lockSessionForRefresh(tx, claims.jti))) {
          throw new UnauthorizedException('无效的刷新令牌');
        }

        const [employee, session] = await Promise.all([
          tx.employee.findUnique({
            where: { id: employeeId },
            include: {
              userRoles: {
                where: { role: { deletedAt: null, status: 'active' } },
                include: { role: { include: { permissions: true } } },
              },
            },
          }),
          tx.session.findUnique({ where: { id: claims.jti } }),
        ]);
        const invalidAfter = employee?.tokenInvalidAfter;
        if (
          !employee ||
          employee.deletedAt ||
          employee.loginStatus !== 'active' ||
          !employee.canLogin ||
          !session ||
          session.employeeId !== employeeId ||
          session.expiresAt <= new Date() ||
          session.refreshToken !== this.sessionsService.hashToken(oldRefreshToken) ||
          (invalidAfter && claims.iat * 1000 <= invalidAfter.getTime())
        ) {
          throw new UnauthorizedException('无效的刷新令牌');
        }

        const refreshExpiresIn = this.configService.get<string>('JWT_REFRESH_EXPIRES_IN', '7d');
        const tokens = await this.generateTokens(
          employee.id,
          employee.username ?? '',
          employee.userRoles.map((r) => r.role.code),
          session.id,
          invalidAfter ?? null,
          session.loginTime
        );
        const rotated = await tx.session.updateMany({
          where: {
            id: session.id,
            employeeId,
            refreshToken: this.sessionsService.hashToken(oldRefreshToken),
          },
          data: {
            refreshToken: this.sessionsService.hashToken(tokens.refreshToken),
            expiresAt: this.calculateExpiresAt(refreshExpiresIn),
            lastActiveTime: new Date(),
          },
        });
        if (rotated.count !== 1) throw new UnauthorizedException('无效的刷新令牌');

        return {
          accessToken: tokens.accessToken,
          refreshToken: tokens.refreshToken,
          expiresIn: tokens.expiresIn,
          user: this.buildAuthUser(employee, employee.username ?? ''),
        };
      });
    } catch (error) {
      if (error instanceof UnauthorizedException) throw error;
      throw new UnauthorizedException('无效的刷新令牌');
    }
  }

  /**
   * 用户登出
   * push 6: 入参直接是 employee.id（与 sessions/loginLog 主索引一致）
   */
  async logout(employeeId: string, ip?: string, refreshToken?: string, currentSessionId?: string) {
    // access token 的 jti 是当前会话权威标识；兼容旧调用方时才回落 refresh token。
    if (currentSessionId) {
      await this.sessionsService.deleteCurrentSession(employeeId, currentSessionId);
    } else if (refreshToken) {
      await this.sessionsService.deleteByRefreshToken(refreshToken);
    }

    // 记录登出日志
    const employee = await this.prisma.employee.findUnique({
      where: { id: employeeId },
      select: { username: true },
    });
    await this.prisma.loginLog.create({
      data: {
        employeeId,
        username: employee?.username || 'unknown',
        actionType: 'logout',
        ip: ip || 'unknown',
        status: 'success',
      },
    });

    this.logger.log(`员工 ${employeeId} 登出成功`);

    return { message: '登出成功' };
  }

  /**
   * 生成 JWT 令牌（access 和 refresh 使用不同 secret）
   *
   * push 6: payload.sub = employee.id（user 表已删）。
   * 仍保留 eid 字段作为冗余别名，兼容期间签发的旧逻辑。
   */
  private async generateTokens(
    employeeId: string,
    username: string,
    roles: string[],
    sessionId: string,
    tokenInvalidAfter: Date | null,
    authenticatedAt: Date,
    customAccessExpiresIn?: string,
    customRefreshExpiresIn?: string
  ) {
    // tokenInvalidAfter 可能位于当前秒内；iat 必须严格越过该边界（JwtStrategy 使用 <=）。
    const issuedAtSeconds = Math.max(
      Math.floor(Date.now() / 1000),
      tokenInvalidAfter ? Math.floor(tokenInvalidAfter.getTime() / 1000) + 1 : 0
    );
    const authenticatedAtSeconds = Math.floor(authenticatedAt.getTime() / 1000);
    if (!Number.isFinite(authenticatedAtSeconds) || authenticatedAtSeconds <= 0) {
      throw new UnauthorizedException('无效的认证时间');
    }
    const payload: Record<string, unknown> = {
      sub: employeeId,
      eid: employeeId,
      username,
      roles,
      jti: sessionId,
      iat: issuedAtSeconds,
      auth_time: authenticatedAtSeconds,
    };

    const accessExpiresIn =
      customAccessExpiresIn || this.configService.get<string>('JWT_ACCESS_EXPIRES_IN', '2h');
    const refreshExpiresIn =
      customRefreshExpiresIn || this.configService.get<string>('JWT_REFRESH_EXPIRES_IN', '7d');

    // Refresh Token 使用独立 secret；禁止回落到 access token secret。
    const refreshSecret = this.configService.getOrThrow<string>('JWT_REFRESH_SECRET');

    // @nestjs/jwt@11 收紧了 expiresIn 类型,需用 StringValue 字面量;运行时仍接受 '2h' 等字符串
    type JwtExpiresIn = `${number}${'s' | 'm' | 'h' | 'd'}`;
    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(
        { ...payload, tokenType: 'access' },
        { expiresIn: accessExpiresIn as JwtExpiresIn }
      ),
      this.jwtService.signAsync(
        { ...payload, tokenType: 'refresh' },
        { expiresIn: refreshExpiresIn as JwtExpiresIn, secret: refreshSecret }
      ),
    ]);

    // 解析过期时间
    const expiresIn = this.parseExpiresIn(accessExpiresIn);

    return {
      accessToken,
      refreshToken,
      expiresIn,
    };
  }

  /**
   * 解析过期时间字符串为秒数
   */
  private parseExpiresIn(expiresIn: string): number {
    const match = expiresIn.match(/^(\d+)([smhd])$/);
    if (!match) return 900; // 默认 15 分钟

    const value = parseInt(match[1] ?? '15', 10);
    const unit = match[2];

    switch (unit) {
      case 's':
        return value;
      case 'm':
        return value * 60;
      case 'h':
        return value * 3600;
      case 'd':
        return value * 86400;
      default:
        return 900;
    }
  }

  /**
   * 解析 User-Agent 获取设备信息
   */
  private parseUserAgent(userAgent?: string): {
    deviceType: string;
    deviceName: string;
    browser: string;
    os: string;
  } {
    if (!userAgent) {
      return {
        deviceType: 'desktop',
        deviceName: 'Unknown Device',
        browser: 'Unknown',
        os: 'Unknown',
      };
    }

    const result = Bowser.parse(userAgent);

    let deviceType = 'desktop';
    const platformType = result.platform.type;
    if (platformType === 'mobile') {
      deviceType = 'mobile';
    } else if (platformType === 'tablet') {
      deviceType = 'tablet';
    }

    const deviceName = result.platform.model
      ? `${result.platform.vendor || ''} ${result.platform.model}`.trim()
      : result.os.name || 'Unknown Device';

    const browser = result.browser.name
      ? `${result.browser.name} ${result.browser.version || ''}`.trim()
      : 'Unknown';

    const os = result.os.name ? `${result.os.name} ${result.os.version || ''}`.trim() : 'Unknown';

    return {
      deviceType,
      deviceName,
      browser,
      os,
    };
  }

  /**
   * 计算过期时间
   */
  private calculateExpiresAt(expiresIn: string): Date {
    const seconds = this.parseExpiresIn(expiresIn);
    return new Date(Date.now() + seconds * 1000);
  }
}
