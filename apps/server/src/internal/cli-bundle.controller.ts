import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  InternalServerErrorException,
  Res,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';

import { AllowAnyAuthenticatedUser } from '../modules/auth/decorators/allow-any-authenticated.decorator';

/**
 * CLI Bundle 分发接口
 *
 * 设计目的：让服务端发放与当前 server 同版本的 CLI 二进制，消费方
 * 通过 PAT 鉴权拉取。无需任何手工同步。
 *
 * 链路：
 *   apps/cli/src/* → 构建时 esbuild bundle 到 dist/static/cli-bundle.cjs
 *   → 部署产物包含该文件 → 本 controller 通过 fs 读取并返回。
 *
 * 鉴权：复用全局 JwtAuthGuard，任意有效 JWT 或 PAT 都可拉取（CLI 是公开
 * 客户端代码，不含密钥）。但仍要求登录身份，避免无脑公开下载导致流量被刷。
 */
@ApiTags('CLI 分发')
@ApiBearerAuth()
@Controller('cli-bundle')
export class CliBundleController {
  /**
   * 返回 bundle 的 SHA256 hex（轻量探活，agent 端 cache 失效检查用）
   */
  @Get('hash')
  @AllowAnyAuthenticatedUser()
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'CLI bundle SHA256（轻量，cache 比对用）' })
  getHash(): { sha256: string } {
    const path = this.resolveHashFile();
    if (!existsSync(path)) {
      throw new InternalServerErrorException(
        'CLI bundle hash not built — server build 未跑 bundle-cli 步骤'
      );
    }
    const sha256 = readFileSync(path, 'utf-8').trim();
    return { sha256 };
  }

  /**
   * 返回 bundle 二进制流（CJS Node 脚本，~1MB）
   *
   * Content-Type 用 application/javascript 让浏览器/curl 能识别；
   * Content-Disposition=attachment 提示客户端保存为文件。
   */
  @Get()
  @AllowAnyAuthenticatedUser()
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  @Header('Content-Type', 'application/javascript; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="azeroth"')
  @ApiOperation({ summary: 'CLI bundle 二进制（self-contained CJS）' })
  download(@Res() res: Response): void {
    const path = this.resolveBundleFile();
    if (!existsSync(path)) {
      throw new InternalServerErrorException(
        'CLI bundle not built — server build 未跑 bundle-cli 步骤'
      );
    }
    res.sendFile(path);
  }

  private resolveBundleFile(): string {
    return join(this.staticDir(), 'cli-bundle.cjs');
  }

  private resolveHashFile(): string {
    return join(this.staticDir(), 'cli-bundle.sha256');
  }

  /**
   * 在 FC 上 cwd=/code，dist 在 /code/dist，static 资源在 /code/dist/static/。
   * 本地 dev (nest start) cwd=apps/server，dist 在 apps/server/dist。
   * process.cwd() 在两种环境都对齐到 server 根。
   */
  private staticDir(): string {
    return join(process.cwd(), 'dist', 'static');
  }
}
