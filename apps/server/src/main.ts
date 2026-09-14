import { VersioningType } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { cleanupOpenApiDoc } from 'nestjs-zod';
import { join } from 'path';

import { AppModule } from './app.module';
import { ClassValidatorValidationPipe } from './common/pipes/class-validator-validation.pipe';
import { requestDiagnosticContextMiddleware } from './common/request-context';

async function bootstrap() {
  const isProduction = process.env.NODE_ENV === 'production';
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: isProduction ? ['error', 'warn', 'log'] : ['error', 'warn', 'log', 'debug', 'verbose'],
  });
  const configService = app.get(ConfigService);

  // trust proxy：让 Express 从 X-Forwarded-For 提取真实客户端 IP。
  // hop 数走 env，默认 1（FC→容器一层代理）；**严禁传 true**，否则客户端可任意伪造 XFF 链。
  // 配合 common/utils/client-ip.helper.ts，登录日志/操作日志的 ip 字段不再落代理 IP。
  app.set('trust proxy', configService.getOrThrow<number>('TRUST_PROXY_HOPS'));

  // 为所有请求建立可验证的 traceId 与起始时间；不采集请求体、凭证或用户画像。
  app.use(requestDiagnosticContextMiddleware);

  // 安全中间件（必须在 useStaticAssets 之前注册，以便 /uploads/* 也走 helmet 默认安全头）
  app.use(helmet());

  // 静态文件服务仅供本地开发。生产文件必须经过登录态 + 员工绑定的短时下载令牌，
  // 不能从 API 域名绕过业务授权直接读取 OSS 挂载目录。
  // P0 fix §4.4: setHeaders 强制 nosniff + 严格 CSP + 对 risky 扩展名强制 attachment 下载。
  // 这是兜底层防御：upload.controller 的 uploadFileFilter 已经在入口拦截 .html 等；
  // 若日后白名单漏过（例如新增 MIME 时配置出错），静态服务这层仍能防止浏览器执行 script。
  if (configService.get<string>('NODE_ENV') !== 'production') {
    const RISKY_EXTENSIONS = new Set(['html', 'htm', 'svg', 'xml', 'xhtml', 'js', 'mjs']);
    app.useStaticAssets(join(process.cwd(), 'uploads'), {
      prefix: '/uploads/',
      setHeaders: (res, filePath) => {
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
        const ext = filePath.toLowerCase().split('.').pop() ?? '';
        if (RISKY_EXTENSIONS.has(ext)) {
          res.setHeader('Content-Disposition', 'attachment');
        }
      },
    });
  }

  // CORS 配置
  const corsOrigins = configService
    .getOrThrow<string>('CORS_ORIGIN')
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
  app.enableCors({
    origin: corsOrigins,
    credentials: true,
  });

  // API 前缀
  app.setGlobalPrefix(configService.getOrThrow<string>('API_PREFIX'));

  // API 版本控制
  app.enableVersioning({
    type: VersioningType.URI,
    defaultVersion: '1',
  });

  // 全局验证管道
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

  // Swagger API 文档
  if (configService.get<string>('NODE_ENV') !== 'production') {
    const config = new DocumentBuilder()
      .setTitle('Azeroth API')
      .setDescription('Azeroth API')
      .setVersion('1.0')
      .addBearerAuth()
      .build();
    const openApiDoc = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('api/docs', app, cleanupOpenApiDoc(openApiDoc));
  }

  const port = configService.getOrThrow<number>('PORT');
  await app.listen(port);

  console.log(`🚀 服务已启动: http://localhost:${port}`); // @log-ok: 启动横幅，无敏感信息
  console.log(`📚 API 文档: http://localhost:${port}/api/docs`); // @log-ok: 启动横幅，无敏感信息
}

bootstrap();
