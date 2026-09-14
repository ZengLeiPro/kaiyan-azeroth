import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Headers,
  HttpException,
  HttpStatus,
  Logger,
  Post,
  VERSION_NEUTRAL,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import * as crypto from 'crypto';
import { gunzipSync } from 'zlib';

import { SkipAudit } from '../common/decorators/skip-audit.decorator';
import { PrismaService } from '../common/prisma/prisma.service';
import { toJsonValue } from '../common/utils/json-type-helpers';
import { Public } from '../modules/auth/decorators/public.decorator';
import {
  FinanceImportService,
  type PreparedDingtalkImportPayload,
} from '../modules/finance/import/services/finance-import.service';

const PREPARED_IMPORT_OPERATION = 'finance-import-dingtalk-prepared-commit';
const PREPARED_IMPORT_CONFIRM = 'FINANCE_IMPORT_DINGTALK_PREPARED_COMMIT';
const MAX_COMPRESSED_PAYLOAD_BYTES = 10 * 1024 * 1024;
const MAX_DECOMPRESSED_PAYLOAD_BYTES = 25 * 1024 * 1024;
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._:-]{8,120}$/;
const STALE_RUNNING_EXECUTION_MS = 15 * 60 * 1000;

interface PreparedFinanceImportRequest {
  confirm?: string;
  payloadGzipBase64?: string;
}

type PreparedImportResult = Awaited<
  ReturnType<FinanceImportService['commitPreparedDingtalkImport']>
>;

interface PreparedImportResponse {
  success: true;
  result: PreparedImportResult;
  idempotencyKey: string;
  replayed: boolean;
}

function decodePreparedFinanceImportPayload(payloadGzipBase64: string | undefined): {
  payload: PreparedDingtalkImportPayload;
  requestHash: string;
} {
  if (!payloadGzipBase64 || typeof payloadGzipBase64 !== 'string') {
    throw new BadRequestException('payloadGzipBase64 不能为空');
  }
  if (payloadGzipBase64.length > Math.ceil((MAX_COMPRESSED_PAYLOAD_BYTES * 4) / 3) + 4) {
    throw new BadRequestException('压缩 payload 超过 10MB 上限');
  }

  try {
    const compressed = Buffer.from(payloadGzipBase64, 'base64');
    if (compressed.length === 0 || compressed.length > MAX_COMPRESSED_PAYLOAD_BYTES) {
      throw new Error('压缩 payload 大小非法');
    }
    const json = gunzipSync(compressed, {
      maxOutputLength: MAX_DECOMPRESSED_PAYLOAD_BYTES,
    }).toString('utf8');
    return {
      payload: JSON.parse(json) as PreparedDingtalkImportPayload,
      requestHash: crypto.createHash('sha256').update(compressed).digest('hex'),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new BadRequestException(`payloadGzipBase64 解码失败: ${message}`);
  }
}

/**
 * 常驻 HTTP 面只保留仍有真实调用方的钉钉财务 prepared import。
 *
 * 数据库迁移已迁到无 HTTP trigger 的独立 migrator；历史 backfill/cleanup/merge
 * 均不再注册路由。保留入口同时要求共享运维令牌、动作级确认和幂等键。
 */
@Public()
@Controller({ path: 'internal', version: VERSION_NEUTRAL })
@SkipAudit()
export class InternalController {
  private readonly logger = new Logger(InternalController.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
    private readonly financeImportService: FinanceImportService
  ) {}

  @Post(PREPARED_IMPORT_OPERATION)
  async commitPreparedDingtalkImport(
    @Headers('x-migration-token') token: string | undefined,
    @Headers('x-idempotency-key') idempotencyKey: string | undefined,
    @Body() body: PreparedFinanceImportRequest
  ): Promise<PreparedImportResponse> {
    this.validateToken(token);
    if (body.confirm !== PREPARED_IMPORT_CONFIRM) {
      throw new BadRequestException(`confirm 必须为 ${PREPARED_IMPORT_CONFIRM}`);
    }
    if (!idempotencyKey || !IDEMPOTENCY_KEY_PATTERN.test(idempotencyKey)) {
      throw new BadRequestException('x-idempotency-key 必须为 8-120 位安全字符');
    }

    const { payload, requestHash } = decodePreparedFinanceImportPayload(body.payloadGzipBase64);
    const claimed = await this.claimExecution(idempotencyKey, requestHash);
    if (claimed.replayedResult) {
      return {
        success: true,
        result: claimed.replayedResult,
        idempotencyKey,
        replayed: true,
      };
    }

    this.logger.log(
      `${PREPARED_IMPORT_OPERATION} started key=${idempotencyKey} ` +
        `workbookId=${payload.workbookId} years=${payload.years.join(',')} rows=${payload.rows.length}`
    );
    try {
      const result = await this.financeImportService.commitPreparedDingtalkImport(payload, null);
      await this.prisma.internalOperationExecution.update({
        where: { id: claimed.executionId },
        data: {
          status: 'succeeded',
          resultJson: toJsonValue(result),
          finishedAt: new Date(),
        },
      });
      return { success: true, result, idempotencyKey, replayed: false };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      await this.prisma.internalOperationExecution
        .update({
          where: { id: claimed.executionId },
          data: {
            status: 'failed',
            errorMessage: errorMessage.slice(0, 4000),
            finishedAt: new Date(),
          },
        })
        .catch((auditError: unknown) => {
          this.logger.error(
            `记录内部任务失败状态时再次失败: ${
              auditError instanceof Error ? auditError.message : String(auditError)
            }`
          );
        });
      this.logger.error(`${PREPARED_IMPORT_OPERATION} failed: ${errorMessage}`);
      if (error instanceof HttpException) throw error;
      throw new HttpException('内部财务导入失败', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  private validateToken(token: string | undefined): void {
    const expectedToken = this.configService.get<string>('MIGRATION_TOKEN');
    if (!expectedToken) {
      this.logger.error('MIGRATION_TOKEN 未配置');
      throw new HttpException('Internal configuration error', HttpStatus.INTERNAL_SERVER_ERROR);
    }
    if (!token) throw new HttpException('Forbidden', HttpStatus.FORBIDDEN);

    const actual = Buffer.from(token, 'utf8');
    const expected = Buffer.from(expectedToken, 'utf8');
    if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) {
      throw new HttpException('Forbidden', HttpStatus.FORBIDDEN);
    }
  }

  private async claimExecution(
    idempotencyKey: string,
    requestHash: string
  ): Promise<{ executionId: string; replayedResult?: PreparedImportResult }> {
    try {
      const execution = await this.prisma.internalOperationExecution.create({
        data: {
          operation: PREPARED_IMPORT_OPERATION,
          idempotencyKey,
          requestHash,
          status: 'running',
        },
        select: { id: true },
      });
      return { executionId: execution.id };
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') {
        throw error;
      }
    }

    const existing = await this.prisma.internalOperationExecution.findUniqueOrThrow({
      where: {
        operation_idempotencyKey: {
          operation: PREPARED_IMPORT_OPERATION,
          idempotencyKey,
        },
      },
    });
    if (existing.requestHash !== requestHash) {
      throw new ConflictException('同一幂等键不能用于不同 payload');
    }
    if (existing.status === 'succeeded' && existing.resultJson) {
      return {
        executionId: existing.id,
        replayedResult: existing.resultJson as unknown as PreparedImportResult,
      };
    }

    const reclaimed = await this.prisma.internalOperationExecution.updateMany({
      where: {
        id: existing.id,
        requestHash,
        OR: [
          { status: 'failed' },
          {
            status: 'running',
            updatedAt: { lt: new Date(Date.now() - STALE_RUNNING_EXECUTION_MS) },
          },
        ],
      },
      data: {
        status: 'running',
        errorMessage: null,
        finishedAt: null,
      },
    });
    if (reclaimed.count === 1) {
      return { executionId: existing.id };
    }
    throw new ConflictException(`该幂等任务当前状态为 ${existing.status}`);
  }
}
