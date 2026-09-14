import { CallHandler, ExecutionContext, Injectable, Logger, NestInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { Observable, tap } from 'rxjs';

import type { CurrentUserType } from '../../modules/auth/decorators/current-user.decorator';
import { OperationLogsService } from '../../modules/operation-logs/operation-logs.service';
import { SKIP_AUDIT_KEY } from '../decorators/skip-audit.decorator';
import { extractClientIp } from '../utils/client-ip.helper';

/** Express Request 增强：JwtAuthGuard 注入的 user + Express Router 注入的 route */
type AuditedRequest = Request & {
  user?: CurrentUserType;
  route?: { path?: string };
};

/** HTTP method 到操作 action 的映射 */
const METHOD_TO_ACTION: Record<string, string> = {
  POST: 'create',
  PUT: 'update',
  PATCH: 'update',
  DELETE: 'delete',
};

/** 敏感字段白名单：写入 details 前移除/脱敏 */
const SENSITIVE_FIELDS = new Set([
  'password',
  'passwordHash',
  'oldPassword',
  'newPassword',
  'confirmPassword',
  'token',
  'accessToken',
  'refreshToken',
  'secret',
  'apiKey',
  'apiSecret',
  'privateKey',
]);

/** body 体积上限（字节），超出截断以避免 details 列膨胀 */
const MAX_BODY_BYTES = 8 * 1024;

/**
 * 全局操作日志拦截器
 *
 * 自动记录所有 POST/PUT/PATCH/DELETE 请求到 operation_logs 表。
 * - module 从 controller 路径首段推断（剥离 api/v{n} 前缀）
 * - action 从 HTTP method 推断
 * - 仅当响应成功（无异常）才落库
 * - 写入失败不阻塞业务（异步 fire-and-forget）
 * - 标注 @SkipAudit() 的方法或类会跳过
 *
 * 注册位置：app.module.ts providers 中通过 APP_INTERCEPTOR 提供
 */
@Injectable()
export class OperationLogInterceptor implements NestInterceptor {
  private readonly logger = new Logger(OperationLogInterceptor.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly operationLogsService: OperationLogsService
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    // 仅处理 HTTP 请求（不拦截 RPC、WebSocket 等）
    if (context.getType() !== 'http') {
      return next.handle();
    }

    const request = context.switchToHttp().getRequest<AuditedRequest>();
    const method: string = request.method;
    const action = this.inferAction(request, method);

    // 仅记录写操作
    if (!action) {
      return next.handle();
    }

    // 检查 @SkipAudit() 装饰器（方法级或类级）
    const skip = this.reflector.getAllAndOverride<boolean>(SKIP_AUDIT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (skip) {
      return next.handle();
    }

    return next.handle().pipe(
      tap({
        next: (response) => {
          this.writeLog(request, action, response).catch((err: unknown) => {
            this.logger.error(
              `Failed to write operation log: ${err instanceof Error ? err.message : String(err)}`
            );
          });
        },
        // 错误不写日志（避免对 4xx/5xx 请求记录假成功）
      })
    );
  }

  private async writeLog(
    request: AuditedRequest,
    action: string,
    response: unknown
  ): Promise<void> {
    const user = request.user;
    const employeeId = user?.employeeId ?? user?.id ?? null;

    const module = this.inferModule(request);
    if (!module) {
      // 无法推断 module 的请求跳过（例如根路径或 health 检查未被 SkipAudit 标记的边缘情况）
      return;
    }

    const ipAddress = this.getClientIp(request);
    const target = this.extractTarget(request, response);
    const details = this.buildDetails(request);

    await this.operationLogsService.log({
      employeeId,
      ipAddress,
      module,
      action,
      target,
      details,
    });
  }

  /**
   * 从请求路径推断业务模块名。
   * 路径形如 `/api/v1/customers/:id` → `customers`
   * 兼容无 v 前缀（自定义 globalPrefix 配置）。
   */
  private inferModule(request: AuditedRequest): string | null {
    const segments = this.getPathSegments(request);

    // 跳过 api 前缀和 v{n} 版本段
    let i = 0;
    if (segments[i] === 'api') i++;
    const versionSeg = segments[i];
    if (versionSeg && /^v\d+$/.test(versionSeg)) i++;

    return segments[i] || null;
  }

  private getPathSegments(request: AuditedRequest): string[] {
    const path: string = request.route?.path ?? request.path ?? request.url ?? '';
    // 剥离 query string
    const cleanPath = path.split('?')[0] ?? '';
    // 拆分路径段，过滤空段
    return cleanPath.split('/').filter(Boolean);
  }

  private inferAction(request: AuditedRequest, method: string): string | undefined {
    const fallback = METHOD_TO_ACTION[method];
    if (!fallback) return undefined;

    const segments = this.getPathSegments(request);
    const last = segments[segments.length - 1];
    if (!last) return fallback;

    const normalized = last.replace(/^:/, '');
    const specialActionMap: Record<string, string> = {
      claim: 'claim',
      restore: 'restore',
      'submit-approval': 'submit-approval',
      'submit-refund-approval': 'submit-refund',
      'red-void': 'red-void',
      'batch-transfer': 'batch-transfer',
      'batch-update': 'batch-update',
      'batch-add-collaborators': 'batch-add-collab',
      'batch-remove-collaborators': 'batch-remove-collab',
      'dingtalk-binding': method === 'DELETE' ? 'unbind' : method === 'PUT' ? 'bind' : fallback,
      batch: method === 'DELETE' ? 'batch-delete' : fallback,
      permanent: method === 'DELETE' ? 'permanent-delete' : fallback,
    };

    return specialActionMap[normalized] ?? fallback;
  }

  /** 取目标 ID（路由参数中的 id） */
  private extractTarget(request: AuditedRequest, response: unknown): string | undefined {
    const params = request.params as Record<string, string | undefined> | undefined;
    const id = params?.id ?? params?.uuid;
    if (id) return String(id);

    return this.extractResponseId(response);
  }

  private extractResponseId(response: unknown): string | undefined {
    if (!response || typeof response !== 'object') return undefined;
    const record = response as Record<string, unknown>;
    if (typeof record.id === 'string') return record.id;
    const data = record.data;
    if (data && typeof data === 'object') {
      const dataRecord = data as Record<string, unknown>;
      if (typeof dataRecord.id === 'string') return dataRecord.id;
    }
    return undefined;
  }

  /** 客户端 IP（兼容代理转发，参见 common/utils/client-ip.helper.ts） */
  private getClientIp(request: AuditedRequest): string | undefined {
    return extractClientIp(request);
  }

  /** 构造 details 字段，含脱敏后的请求体 + 路径参数 */
  private buildDetails(request: AuditedRequest): Record<string, unknown> | undefined {
    const sanitizedBody = this.sanitize(request.body);
    const truncatedBody = this.truncateBody(sanitizedBody);

    const details: Record<string, unknown> = {};
    details.kind = 'request';
    if (truncatedBody && Object.keys(truncatedBody).length > 0) {
      details.body = truncatedBody;
    }
    if (request.params && Object.keys(request.params).length > 0) {
      details.params = request.params;
    }

    return Object.keys(details).length > 0 ? details : undefined;
  }

  /** 递归脱敏：对敏感字段值替换为 '[REDACTED]' */
  private sanitize(value: unknown): unknown {
    if (value === null || value === undefined) return value;
    if (Array.isArray(value)) {
      return value.map((item) => this.sanitize(item));
    }
    if (typeof value === 'object') {
      const result: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        if (SENSITIVE_FIELDS.has(k)) {
          result[k] = '[REDACTED]';
        } else {
          result[k] = this.sanitize(v);
        }
      }
      return result;
    }
    return value;
  }

  /** 当 body 超过 MAX_BODY_BYTES 时截断为字符串提示 */
  private truncateBody(body: unknown): unknown {
    if (!body || typeof body !== 'object') return body;
    try {
      const json = JSON.stringify(body);
      if (json.length > MAX_BODY_BYTES) {
        return { _truncated: true, size: json.length, preview: json.slice(0, 512) };
      }
      return body;
    } catch {
      return { _unserializable: true };
    }
  }
}
