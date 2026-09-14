import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import { PrismaService } from '../../common/prisma/prisma.service';
import { Public } from '../auth/decorators/public.decorator';

@ApiTags('健康检查')
@Controller('health')
@Public()
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @ApiOperation({ summary: '健康检查' })
  @ApiResponse({ status: 200, description: '服务正常运行' })
  check(): { status: string; timestamp: string; version: string; releaseSha: string } {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      version: process.env.npm_package_version || '0.1.0',
      releaseSha: process.env.RELEASE_SHA || 'unknown',
    };
  }

  @Get('ready')
  @ApiOperation({ summary: '就绪检查（数据库、迁移与发布版本）' })
  @ApiResponse({ status: 200, description: '服务具备接流量条件' })
  @ApiResponse({ status: 503, description: '服务尚未就绪' })
  async ready(): Promise<{ status: 'ready'; timestamp: string; releaseSha: string }> {
    try {
      // @prisma-raw-sql: readiness 需要真实探测当前数据库连接，而不是读取业务模型。
      await this.prisma.$queryRaw`SELECT 1`;
      // @prisma-raw-sql: Prisma 没有读取自身迁移元数据的模型 API。
      const failed = await this.prisma.$queryRaw<Array<{ count: bigint }>>`
        SELECT COUNT(*)::bigint AS count
          FROM "_prisma_migrations"
         WHERE "started_at" IS NOT NULL
           AND "finished_at" IS NULL
           AND "rolled_back_at" IS NULL
      `;
      if (Number(failed[0]?.count ?? 0) > 0) throw new Error('存在未完成迁移');
      return {
        status: 'ready',
        timestamp: new Date().toISOString(),
        releaseSha: process.env.RELEASE_SHA || 'unknown',
      };
    } catch {
      throw new ServiceUnavailableException({
        status: 'not_ready',
        releaseSha: process.env.RELEASE_SHA || 'unknown',
      });
    }
  }
}
