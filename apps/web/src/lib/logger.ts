/** Safe, structured client diagnostics. The default adapter never sends data over the network. */

export type LogLevel = 'error' | 'warn' | 'info';

export interface SafeLogError {
  name: string;
  message: string;
  stack?: string;
}

export interface SafeLogEvent {
  level: LogLevel;
  context: string;
  message: string;
  timestamp: string;
  traceId?: string;
  error?: SafeLogError;
  details?: unknown;
}

export interface LoggerReporter {
  report(event: SafeLogEvent): void;
}

type SanitizationBudget = {
  nodesLeft: number;
  bytesLeft: number;
};

const REDACTED = '[REDACTED]';
const UNSERIALIZABLE = '[UNSERIALIZABLE]';
const BUDGET_EXCEEDED = '[BUDGET_EXCEEDED]';
const MAX_STRING_LENGTH = 2_000;
const MAX_STACK_LENGTH = 8_000;
const MAX_DEPTH = 5;
const MAX_COLLECTION_SIZE = 30;
const MAX_LOG_NODES = 120;
const MAX_LOG_BYTES = 24_000;
const TRACE_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;
const AUTHORIZATION_HEADER_PATTERN =
  /(\b(?:proxy-authorization|authorization)\s*[:=]\s*)[^\r\n]*/gi;
const SENSITIVE_KEY_PATTERN =
  /(?:authorization|password|passwd|secret|token|authcode|apikey|cookie|session)/i;

function truncate(value: string, limit = MAX_STRING_LENGTH): string {
  return value.length <= limit ? value : `${value.slice(0, limit)}…[TRUNCATED]`;
}

function safeGet(value: unknown, key: PropertyKey): unknown {
  if ((typeof value !== 'object' || value === null) && typeof value !== 'function')
    return undefined;
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

function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function consumeBytes(value: string, budget: SanitizationBudget): string {
  if (budget.bytesLeft <= 0) return BUDGET_EXCEEDED;
  const valueBytes = utf8ByteLength(value);
  if (valueBytes <= budget.bytesLeft) {
    budget.bytesLeft -= valueBytes;
    return value;
  }

  const suffix = '…[BYTE_BUDGET]';
  let low = 0;
  let high = value.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (utf8ByteLength(value.slice(0, middle) + suffix) <= budget.bytesLeft) low = middle;
    else high = middle - 1;
  }
  const result = low > 0 ? value.slice(0, low) + suffix : BUDGET_EXCEEDED;
  budget.bytesLeft = Math.max(0, budget.bytesLeft - utf8ByteLength(result));
  return result;
}

export function sanitizeLogString(value: string, limit = MAX_STRING_LENGTH): string {
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
    limit
  );
}

function sanitizeLogValueInternal(
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
    if (typeof value === 'string') return consumeBytes(sanitizeLogString(value), budget);
    if (typeof value === 'bigint') return consumeBytes(value.toString(), budget);
    if (typeof value === 'undefined') return undefined;
    if (typeof value === 'symbol' || typeof value === 'function') {
      return consumeBytes(`[${typeof value}]`, budget);
    }
    if (depth >= MAX_DEPTH) return consumeBytes('[MAX_DEPTH]', budget);
    if (typeof value !== 'object') return consumeBytes(sanitizeLogString(String(value)), budget);
    if (seen.has(value)) return consumeBytes('[CIRCULAR]', budget);
    seen.add(value);

    if (safeInstanceOf(value, Error)) {
      const name = safeGet(value, 'name');
      const message = safeGet(value, 'message');
      const stack = safeGet(value, 'stack');
      return {
        name: consumeBytes(
          sanitizeLogString(typeof name === 'string' ? name : 'Error', 120),
          budget
        ),
        message: consumeBytes(
          sanitizeLogString(typeof message === 'string' ? message : UNSERIALIZABLE),
          budget
        ),
        ...(typeof stack === 'string' && budget.bytesLeft > 0
          ? { stack: consumeBytes(sanitizeLogString(stack, MAX_STACK_LENGTH), budget) }
          : {}),
      };
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
        result.push(sanitizeLogValueInternal(safeGet(value, index), depth + 1, seen, budget));
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

    const result: Record<string, unknown> = {};
    for (const key of keys) {
      if (budget.nodesLeft <= 0 || budget.bytesLeft <= 0) {
        if (!Object.prototype.hasOwnProperty.call(result, BUDGET_EXCEEDED)) {
          result[BUDGET_EXCEEDED] = BUDGET_EXCEEDED;
        }
        break;
      }

      let keyText: string;
      try {
        keyText = typeof key === 'symbol' ? String(key) : key;
      } catch {
        keyText = UNSERIALIZABLE;
      }
      const sanitizedKey = sanitizeLogString(keyText, 120);
      let uniqueKey = sanitizedKey;
      let duplicate = 2;
      while (Object.prototype.hasOwnProperty.call(result, uniqueKey)) {
        const suffix = ` [DUPLICATE_${duplicate}]`;
        uniqueKey = `${sanitizedKey.slice(0, Math.max(0, 120 - suffix.length))}${suffix}`;
        duplicate += 1;
      }

      const safeKey = consumeBytes(uniqueKey, budget);
      if (Object.prototype.hasOwnProperty.call(result, safeKey)) {
        if (!Object.prototype.hasOwnProperty.call(result, BUDGET_EXCEEDED)) {
          result[BUDGET_EXCEEDED] = BUDGET_EXCEEDED;
        }
        break;
      }
      const safeValue = SENSITIVE_KEY_PATTERN.test(keyText)
        ? consumeBytes(REDACTED, budget)
        : sanitizeLogValueInternal(safeGet(value, key), depth + 1, seen, budget);
      Object.defineProperty(result, safeKey, {
        value: safeValue,
        enumerable: true,
        configurable: true,
        writable: true,
      });
    }
    return result;
  } catch {
    return consumeBytes(UNSERIALIZABLE, budget);
  }
}

export function sanitizeLogValue(
  value: unknown,
  depth = 0,
  seen: WeakSet<object> = new WeakSet<object>()
): unknown {
  return sanitizeLogValueInternal(value, depth, seen, {
    nodesLeft: MAX_LOG_NODES,
    bytesLeft: MAX_LOG_BYTES,
  });
}

function validTraceId(value: unknown): string | undefined {
  return typeof value === 'string' && TRACE_ID_PATTERN.test(value) ? value : undefined;
}

export function getErrorTraceId(error: unknown): string | undefined {
  try {
    const response = safeGet(error, 'response');
    if (typeof response !== 'object' || response === null) return undefined;

    const data = safeGet(response, 'data');
    const fromBody = validTraceId(safeGet(data, 'traceId'));
    if (fromBody) return fromBody;

    const headers = safeGet(response, 'headers');
    if (typeof headers !== 'object' || headers === null) return undefined;
    const get = safeGet(headers, 'get');
    let fromGet: unknown;
    if (typeof get === 'function') {
      try {
        fromGet = Reflect.apply(get, headers, ['x-request-id']);
      } catch {
        fromGet = undefined;
      }
    }
    return (
      validTraceId(fromGet) ??
      validTraceId(safeGet(headers, 'x-request-id')) ??
      validTraceId(safeGet(headers, 'X-Request-Id'))
    );
  } catch {
    return undefined;
  }
}

function isErrorLike(value: unknown): value is Error {
  return safeInstanceOf(value, Error);
}

function buildEvent(level: LogLevel, context: string, args: unknown[]): SafeLogEvent {
  const errorCandidate = args.find(isErrorLike);
  const traceId = args.map(getErrorTraceId).find((value) => value !== undefined);
  const messageParts = args.filter(
    (value) => typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
  );
  const detailValues = args.filter(
    (value) => !isErrorLike(value) && typeof value === 'object' && value !== null
  );
  const errorName = safeGet(errorCandidate, 'name');
  const errorMessage = safeGet(errorCandidate, 'message');
  const errorStack = safeGet(errorCandidate, 'stack');

  return {
    level,
    context: sanitizeLogString(context, 160),
    message: sanitizeLogString(messageParts.map(String).join(' ') || 'No message'),
    timestamp: new Date().toISOString(),
    ...(traceId ? { traceId } : {}),
    ...(errorCandidate
      ? {
          error: {
            name: sanitizeLogString(typeof errorName === 'string' ? errorName : 'Error', 120),
            message: sanitizeLogString(
              typeof errorMessage === 'string' ? errorMessage : UNSERIALIZABLE
            ),
            ...(typeof errorStack === 'string'
              ? { stack: sanitizeLogString(errorStack, MAX_STACK_LENGTH) }
              : {}),
          },
        }
      : {}),
    ...(detailValues.length > 0 ? { details: sanitizeLogValue(detailValues) } : {}),
  };
}

function fallbackEvent(level: LogLevel): SafeLogEvent {
  return {
    level,
    context: 'Logger',
    message: 'Diagnostic event could not be serialized',
    timestamp: new Date().toISOString(),
    error: { name: 'DiagnosticSerializationError', message: UNSERIALIZABLE },
  };
}

function createConsoleReporter(isProduction: boolean): LoggerReporter {
  return {
    report(event) {
      if (isProduction) {
        if (event.level === 'error') {
          // @console-ok: production logger sink; emits only sanitized error summary + traceId.
          console.error({
            error: event.error ?? { name: 'Error', message: event.message },
            ...(event.traceId ? { traceId: event.traceId } : {}),
          });
        }
        return;
      }

      if (event.level === 'error') {
        // @console-ok: development logger sink.
        console.error(event);
      } else if (event.level === 'warn') {
        // @console-ok: development logger sink.
        console.warn(event);
      } else {
        // @console-ok: development logger sink.
        console.info(event);
      }
    },
  };
}

export function createLogger(options: { isProduction: boolean; reporter?: LoggerReporter }) {
  const reporter = options.reporter ?? createConsoleReporter(options.isProduction);
  const emit = (level: LogLevel, context: string, args: unknown[]) => {
    try {
      reporter.report(buildEvent(level, context, args));
    } catch {
      try {
        reporter.report(fallbackEvent(level));
      } catch {
        // Diagnostics must never break the user flow. Do not retry or call an external fallback.
      }
    }
  };

  return {
    error(context: string, ...args: unknown[]): void {
      emit('error', context, args);
    },
    warn(context: string, ...args: unknown[]): void {
      emit('warn', context, args);
    },
    info(context: string, ...args: unknown[]): void {
      emit('info', context, args);
    },
  };
}

let reporterOverride: LoggerReporter | undefined;

/** Inject a reporter owned by the host application. Passing undefined restores the local console adapter. */
export function setLoggerReporter(reporter?: LoggerReporter): void {
  reporterOverride = reporter;
}

const emitWithConfiguredReporter = (level: LogLevel, context: string, args: unknown[]) => {
  createLogger({
    isProduction: import.meta.env.PROD,
    ...(reporterOverride ? { reporter: reporterOverride } : {}),
  })[level](context, ...args);
};

export const logger = {
  error(context: string, ...args: unknown[]): void {
    emitWithConfiguredReporter('error', context, args);
  },
  warn(context: string, ...args: unknown[]): void {
    emitWithConfiguredReporter('warn', context, args);
  },
  info(context: string, ...args: unknown[]): void {
    emitWithConfiguredReporter('info', context, args);
  },
};
