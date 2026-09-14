import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library';
import type { Response } from 'express';

import { ensureRequestDiagnosticContext, RequestWithDiagnosticContext } from '../request-context';

type ErrorResponseBody = {
  statusCode: number;
  message: string | string[];
  code: string;
  traceId: string;
  timestamp: string;
  path: string;
  details?: unknown;
};

type AuthenticatedRequest = RequestWithDiagnosticContext & {
  user?: { id?: unknown; employeeId?: unknown };
  route?: { path?: unknown };
};

type PrismaKnownRequestError = PrismaClientKnownRequestError;

type ServerErrorDiagnostic = {
  type: 'server_error';
  traceId: string;
  error: unknown;
  method: string;
  path: string;
  userId?: string;
  latencyMs: number;
};

type SanitizationBudget = {
  nodesLeft: number;
  bytesLeft: number;
};

const REDACTED = '[REDACTED]';
const UNSERIALIZABLE = '[UNSERIALIZABLE]';
const BUDGET_EXCEEDED = '[BUDGET_EXCEEDED]';
const MAX_STRING_LENGTH = 2_000;
const MAX_STACK_LENGTH = 12_000;
const MAX_COLLECTION_SIZE = 30;
const MAX_DEPTH = 6;
const MAX_DIAGNOSTIC_NODES = 120;
const MAX_DIAGNOSTIC_BYTES = 24_000;
const SAFE_UNKNOWN_PATH = '[unmatched-route]';
const AUTHORIZATION_HEADER_PATTERN =
  /(\b(?:proxy-authorization|authorization)\s*[:=]\s*)[^\r\n]*/gi;
const SENSITIVE_KEY_PATTERN =
  /(?:authorization|password|passwd|secret|token|authcode|apikey|cookie|session)/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function safeGet(value: unknown, key: PropertyKey): unknown {
  if (!isRecord(value) && typeof value !== 'function') return undefined;
  try {
    return Reflect.get(value, key);
  } catch {
    return undefined;
  }
}

function safeInstanceOf(
  value: unknown,
  constructor: abstract new (...args: never[]) => object
): boolean {
  try {
    return value instanceof constructor;
  } catch {
    return false;
  }
}

function isPrismaKnownRequestError(value: unknown): value is PrismaKnownRequestError {
  return safeInstanceOf(value, PrismaClientKnownRequestError);
}

function truncate(value: string, maxLength = MAX_STRING_LENGTH): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength)}…[TRUNCATED]`;
}

function byteLength(value: string): number {
  return Buffer.byteLength(value, 'utf8');
}

function consumeBytes(value: string, budget: SanitizationBudget): string {
  if (budget.bytesLeft <= 0) return BUDGET_EXCEEDED;
  if (byteLength(value) <= budget.bytesLeft) {
    budget.bytesLeft -= byteLength(value);
    return value;
  }

  const suffix = '…[BYTE_BUDGET]';
  let low = 0;
  let high = value.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (byteLength(value.slice(0, middle) + suffix) <= budget.bytesLeft) low = middle;
    else high = middle - 1;
  }
  const result = low > 0 ? value.slice(0, low) + suffix : BUDGET_EXCEEDED;
  budget.bytesLeft = Math.max(0, budget.bytesLeft - byteLength(result));
  return result;
}

/** Redact credentials embedded in free text and all URL query values before logging. */
export function sanitizeDiagnosticString(value: string, maxLength = MAX_STRING_LENGTH): string {
  return truncate(
    value
      .replace(AUTHORIZATION_HEADER_PATTERN, `$1${REDACTED}`)
      .replace(/\bBearer\s+[^\s,;]+/gi, `Bearer ${REDACTED}`)
      .replace(
        /((?:authorization|password|passwd|secret|token|auth[_-]?code|api[_-]?key|cookie|session)\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;&]+)/gi,
        `$1${REDACTED}`
      )
      .replace(/([?&][^=&#\s]+)=([^&#\s]*)/g, `$1=${REDACTED}`)
      .replace(/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}(?:\.[A-Za-z0-9_-]{10,})?\b/g, REDACTED),
    maxLength
  );
}

function sanitizeDiagnosticValueInternal(
  value: unknown,
  depth: number,
  seen: WeakSet<object>,
  budget: SanitizationBudget
): unknown {
  if (budget.nodesLeft <= 0 || budget.bytesLeft <= 0) return BUDGET_EXCEEDED;
  budget.nodesLeft -= 1;

  try {
    if (value === null) return null;
    if (typeof value === 'boolean' || typeof value === 'number') {
      return consumeBytes(String(value), budget) === BUDGET_EXCEEDED ? BUDGET_EXCEEDED : value;
    }
    if (typeof value === 'string') {
      return consumeBytes(sanitizeDiagnosticString(value), budget);
    }
    if (typeof value === 'bigint') return consumeBytes(value.toString(), budget);
    if (typeof value === 'undefined') return undefined;
    if (typeof value === 'symbol' || typeof value === 'function') {
      return consumeBytes(`[${typeof value}]`, budget);
    }
    if (depth >= MAX_DEPTH) return consumeBytes('[MAX_DEPTH]', budget);
    if (typeof value !== 'object') {
      return consumeBytes(sanitizeDiagnosticString(String(value)), budget);
    }
    if (seen.has(value)) return consumeBytes('[CIRCULAR]', budget);
    seen.add(value);

    if (safeInstanceOf(value, Error)) {
      const name = safeGet(value, 'name');
      const message = safeGet(value, 'message');
      const stack = safeGet(value, 'stack');
      const cause = safeGet(value, 'cause');
      const result: Record<string, unknown> = {
        name: consumeBytes(
          sanitizeDiagnosticString(typeof name === 'string' ? name : 'Error', 120),
          budget
        ),
        message: consumeBytes(
          sanitizeDiagnosticString(typeof message === 'string' ? message : UNSERIALIZABLE),
          budget
        ),
      };
      if (typeof stack === 'string' && budget.nodesLeft > 0 && budget.bytesLeft > 0) {
        result.stack = consumeBytes(sanitizeDiagnosticString(stack, MAX_STACK_LENGTH), budget);
      }
      if (cause !== undefined && budget.nodesLeft > 0 && budget.bytesLeft > 0) {
        result.cause = sanitizeDiagnosticValueInternal(cause, depth + 1, seen, budget);
      }
      return result;
    }

    if (Array.isArray(value)) {
      const result: unknown[] = [];
      const lengthValue = safeGet(value, 'length');
      const length =
        typeof lengthValue === 'number' ? Math.min(lengthValue, MAX_COLLECTION_SIZE) : 0;
      for (let index = 0; index < length; index += 1) {
        if (budget.nodesLeft <= 0 || budget.bytesLeft <= 0) {
          result.push(BUDGET_EXCEEDED);
          break;
        }
        result.push(
          sanitizeDiagnosticValueInternal(safeGet(value, index), depth + 1, seen, budget)
        );
      }
      return result;
    }

    let keys: (string | symbol)[];
    try {
      keys = Reflect.ownKeys(value)
        .filter((key) => {
          try {
            return Object.prototype.propertyIsEnumerable.call(value, key);
          } catch {
            return false;
          }
        })
        .slice(0, MAX_COLLECTION_SIZE);
    } catch {
      return consumeBytes(UNSERIALIZABLE, budget);
    }

    const sanitized: Record<string, unknown> = {};
    for (const key of keys) {
      if (budget.nodesLeft <= 0 || budget.bytesLeft <= 0) {
        if (!Object.prototype.hasOwnProperty.call(sanitized, BUDGET_EXCEEDED)) {
          sanitized[BUDGET_EXCEEDED] = BUDGET_EXCEEDED;
        }
        break;
      }

      let keyText: string;
      try {
        keyText = typeof key === 'symbol' ? String(key) : key;
      } catch {
        keyText = UNSERIALIZABLE;
      }
      const sanitizedKey = sanitizeDiagnosticString(keyText, 120);
      let uniqueKey = sanitizedKey;
      let duplicate = 2;
      while (Object.prototype.hasOwnProperty.call(sanitized, uniqueKey)) {
        const suffix = ` [DUPLICATE_${duplicate}]`;
        uniqueKey = `${sanitizedKey.slice(0, Math.max(0, 120 - suffix.length))}${suffix}`;
        duplicate += 1;
      }

      const safeKey = consumeBytes(uniqueKey, budget);
      if (Object.prototype.hasOwnProperty.call(sanitized, safeKey)) {
        if (!Object.prototype.hasOwnProperty.call(sanitized, BUDGET_EXCEEDED)) {
          sanitized[BUDGET_EXCEEDED] = BUDGET_EXCEEDED;
        }
        break;
      }
      const safeValue = SENSITIVE_KEY_PATTERN.test(keyText)
        ? consumeBytes(REDACTED, budget)
        : sanitizeDiagnosticValueInternal(safeGet(value, key), depth + 1, seen, budget);
      Object.defineProperty(sanitized, safeKey, {
        value: safeValue,
        enumerable: true,
        configurable: true,
        writable: true,
      });
    }
    return sanitized;
  } catch {
    return consumeBytes(UNSERIALIZABLE, budget);
  }
}

export function sanitizeDiagnosticValue(
  value: unknown,
  depth = 0,
  seen: WeakSet<object> = new WeakSet<object>()
): unknown {
  return sanitizeDiagnosticValueInternal(value, depth, seen, {
    nodesLeft: MAX_DIAGNOSTIC_NODES,
    bytesLeft: MAX_DIAGNOSTIC_BYTES,
  });
}

function safeRequestPath(request: AuthenticatedRequest): string {
  const routePath = safeGet(safeGet(request, 'route'), 'path');
  if (typeof routePath !== 'string' || routePath.length === 0) return SAFE_UNKNOWN_PATH;
  return sanitizeDiagnosticString(routePath.split('?')[0] || SAFE_UNKNOWN_PATH, 1_000);
}

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<AuthenticatedRequest>();
    const requestContext = ensureRequestDiagnosticContext(request);
    let normalized: ReturnType<GlobalExceptionFilter['normalizeException']>;
    try {
      normalized = this.normalizeException(exception);
    } catch {
      normalized = {
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        message: '服务器内部错误',
        code: 'INTERNAL_SERVER_ERROR',
      };
    }
    const { statusCode, message, code, details } = normalized;
    const safePath = safeRequestPath(request);
    const isServerError = statusCode >= 500;

    const body: ErrorResponseBody = {
      statusCode,
      message: isServerError ? '服务器内部错误' : message,
      code: isServerError ? 'INTERNAL_SERVER_ERROR' : code,
      traceId: requestContext.traceId,
      timestamp: new Date().toISOString(),
      path: safePath,
    };

    if (!isServerError && process.env.NODE_ENV !== 'production' && details !== undefined) {
      body.details = sanitizeDiagnosticValue(details);
    }

    try {
      if (isServerError) {
        this.logger.error(this.buildServerErrorDiagnostic(exception, request, safePath));
      } else {
        this.logger.warn({
          type: 'client_error',
          traceId: requestContext.traceId,
          method: sanitizeDiagnosticString(String(safeGet(request, 'method') ?? 'UNKNOWN'), 16),
          path: safePath,
          statusCode,
          code: sanitizeDiagnosticValue(code),
          message: sanitizeDiagnosticValue(message),
        });
      }
    } catch {
      // Error diagnostics are best-effort and must never prevent the HTTP response.
    }

    response.status(statusCode).json(body);
  }

  private buildServerErrorDiagnostic(
    exception: unknown,
    request: AuthenticatedRequest,
    safePath: string
  ): ServerErrorDiagnostic {
    const context = ensureRequestDiagnosticContext(request);
    const sanitizedError = sanitizeDiagnosticValue(exception);
    const user = safeGet(request, 'user');
    const stableUserId = safeGet(user, 'employeeId') ?? safeGet(user, 'id');
    const method = safeGet(request, 'method');

    return {
      type: 'server_error',
      traceId: context.traceId,
      error: sanitizedError,
      method: sanitizeDiagnosticString(typeof method === 'string' ? method : 'UNKNOWN', 16),
      path: safePath,
      ...(typeof stableUserId === 'string' && stableUserId.length > 0
        ? { userId: sanitizeDiagnosticString(stableUserId, 128) }
        : {}),
      latencyMs: Math.max(0, Date.now() - context.startedAt),
    };
  }

  private normalizeException(exception: unknown): {
    statusCode: number;
    message: string | string[];
    code: string;
    details?: unknown;
  } {
    if (isPrismaKnownRequestError(exception)) return this.normalizePrismaKnownError(exception);

    if (safeInstanceOf(exception, HttpException)) {
      const httpException = exception as HttpException;
      const statusCode = httpException.getStatus();
      const exceptionResponse = httpException.getResponse();
      if (isRecord(exceptionResponse)) {
        return {
          statusCode,
          message: this.extractMessage(exceptionResponse),
          code: this.extractCode(exceptionResponse, httpException.name),
          details: exceptionResponse,
        };
      }
      return {
        statusCode,
        message: typeof exceptionResponse === 'string' ? exceptionResponse : httpException.message,
        code: httpException.name,
      };
    }

    return {
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      message: '服务器内部错误',
      code: 'INTERNAL_SERVER_ERROR',
    };
  }

  private normalizePrismaKnownError(error: PrismaKnownRequestError): {
    statusCode: number;
    message: string;
    code: string;
    details?: unknown;
  } {
    const errorCode = safeGet(error, 'code');
    const code = typeof errorCode === 'string' ? errorCode : 'UNKNOWN';
    const meta = safeGet(error, 'meta');
    if (code === 'P2002') {
      return {
        statusCode: HttpStatus.CONFLICT,
        message: '数据已存在，请检查唯一字段',
        code: 'PRISMA_UNIQUE_CONSTRAINT',
        details: { prismaCode: code, target: safeGet(meta, 'target') },
      };
    }
    if (code === 'P2025') {
      return {
        statusCode: HttpStatus.NOT_FOUND,
        message: '数据不存在或已被删除',
        code: 'PRISMA_RECORD_NOT_FOUND',
        details: { prismaCode: code },
      };
    }
    if (code === 'P2003') {
      return {
        statusCode: HttpStatus.BAD_REQUEST,
        message: '关联数据不存在或不允许删除',
        code: 'PRISMA_FOREIGN_KEY_CONSTRAINT',
        details: { prismaCode: code, field: safeGet(meta, 'field_name') },
      };
    }
    return {
      statusCode: HttpStatus.BAD_REQUEST,
      message: '数据库请求无效',
      code: `PRISMA_${code}`,
      details: { prismaCode: code },
    };
  }

  private extractMessage(response: Record<string, unknown>): string | string[] {
    const message = safeGet(response, 'message');
    if (typeof message === 'string') return message;
    if (Array.isArray(message)) {
      const safeMessages: string[] = [];
      for (let index = 0; index < message.length; index += 1) {
        const item = safeGet(message, index);
        if (typeof item !== 'string') return '请求处理失败';
        safeMessages.push(item);
      }
      return safeMessages;
    }
    return '请求处理失败';
  }

  private extractCode(response: Record<string, unknown>, fallback: string): string {
    const code = safeGet(response, 'code') ?? safeGet(response, 'error');
    return typeof code === 'string' && code.trim().length > 0 ? code : fallback;
  }
}
