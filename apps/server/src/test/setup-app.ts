import { VersioningType } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test, TestingModule } from '@nestjs/testing';

import { AppModule } from '../app.module';
import { ClassValidatorValidationPipe } from '../common/pipes/class-validator-validation.pipe';

/**
 * 创建 E2E 测试用的 NestJS 应用实例
 *
 * 配置与 main.ts 一致的 globalPrefix、versioning 和 validation pipe，
 * 但不启用 Helmet/CORS（会干扰 supertest）。
 *
 * 速率限制通过 .env.test 中 THROTTLE_LOGIN_LIMIT=1000 放宽，
 * 避免 E2E 测试中累积请求触发限流。
 */
export async function createTestApp(): Promise<NestExpressApplication> {
  const moduleFixture: TestingModule = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  const app = moduleFixture.createNestApplication<NestExpressApplication>();

  app.setGlobalPrefix('api');
  app.enableVersioning({
    type: VersioningType.URI,
    defaultVersion: '1',
  });

  app.useGlobalPipes(
    new ClassValidatorValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: {
        enableImplicitConversion: true,
      },
    })
  );

  await app.init();
  return app;
}
