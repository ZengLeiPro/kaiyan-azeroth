import { forwardRef, Logger, Module, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';

import { DingtalkAuthModule } from '../dingtalk-core/dingtalk-auth.module';
import { SessionsModule } from '../sessions/sessions.module';
import { UsersModule } from '../users/users.module';
import { AuthController } from './auth.controller';
import { AuthService, LOGIN_FAIL_LOCK_THRESHOLD } from './auth.service';
import { PatController } from './pat.controller';
import { PatService } from './services/pat.service';
import { JwtStrategy } from './strategies/jwt.strategy';

@Module({
  imports: [
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const secret = config.get<string>('JWT_SECRET');
        if (!secret) {
          throw new Error('JWT_SECRET environment variable is required');
        }
        return {
          secret,
          signOptions: {
            expiresIn: config.get<string>(
              'JWT_ACCESS_EXPIRES_IN',
              '15m'
            ) as `${number}${'s' | 'm' | 'h' | 'd'}`,
          },
        };
      },
    }),
    UsersModule,
    DingtalkAuthModule,
    forwardRef(() => SessionsModule),
  ],
  controllers: [AuthController, PatController],
  providers: [AuthService, JwtStrategy, PatService],
  exports: [AuthService, PatService],
})
export class AuthModule implements OnApplicationBootstrap {
  private readonly logger = new Logger(AuthModule.name);

  constructor(private readonly configService: ConfigService) {}

  /**
   * P0 fix §2.4 兜底：启动期检查 throttle 限额是否大于账号锁定阈值。
   * 若 THROTTLE_LOGIN_LIMIT ≤ LOGIN_FAIL_LOCK_THRESHOLD，第 N 次失败请求会被
   * Throttler 短路返回 429，业务层锁定逻辑永远跑不到（参见 §2.4 修复理由）。
   * 默认值已经是 10 > 5，安全；但生产环境若被 .env / FC 控制台显式覆盖回 5，
   * 这里会在启动日志里大声警告，防止运维误配置悄悄破坏锁定路径。
   */
  onApplicationBootstrap(): void {
    const throttleLimit = this.configService.getOrThrow<number>('THROTTLE_LOGIN_LIMIT');
    if (throttleLimit <= LOGIN_FAIL_LOCK_THRESHOLD) {
      this.logger.warn(
        `⚠️ THROTTLE_LOGIN_LIMIT=${throttleLimit} ≤ LOGIN_FAIL_LOCK_THRESHOLD=${LOGIN_FAIL_LOCK_THRESHOLD}。` +
          ` 第 ${throttleLimit} 次错误密码请求会被 Throttler 短路返回 429，` +
          `账号自动锁定路径永远不会触发。请把 THROTTLE_LOGIN_LIMIT 升到至少 ${
            LOGIN_FAIL_LOCK_THRESHOLD + 1
          }。`
      );
    }
  }
}
