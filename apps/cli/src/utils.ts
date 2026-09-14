import fs from 'node:fs';
import path from 'node:path';

import { z } from 'zod';

// ── String case conversion ──────────────────────────────────────────

/** PascalCase → kebab-case: SaleOrder → sale-order, CrmWorkDaily → crm-work-daily */
export function pascalToKebab(str: string): string {
  return str
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1-$2')
    .toLowerCase();
}

/** Simple English pluralization (covers the entities in ky-azeroth) */
export function pluralize(str: string): string {
  if (str.endsWith('y') && !/[aeiou]y$/i.test(str)) {
    return str.slice(0, -1) + 'ies';
  }
  if (/(?:s|x|z|ch|sh)$/i.test(str)) {
    return str + 'es';
  }
  return str + 's';
}

/** kebab-case → camelCase: customer-name → customerName */
export function kebabToCamel(str: string): string {
  return str.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
}

/** camelCase → kebab-case: customerName → customer-name */
export function camelToKebab(str: string): string {
  return str.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
}

// ── Zod schema introspection ────────────────────────────────────────

export interface FieldInfo {
  name: string;
  type: string;
  required: boolean;
  /**
   * 字段形态：
   *  - 'scalar'：基础类型（string/number/boolean/enum/literal/union），用 `--field <v>` 传值
   *  - 'object'：嵌套对象，只能用 `--field-json <path>` 整体传 JSON
   *  - 'object-array'：对象数组（如 products），只能用 `--field-json <path>` 传 JSON 数组
   *  - 'scalar-array'：基础类型数组，可重复 `--field v1 --field v2`
   */
  kind: 'scalar' | 'object' | 'object-array' | 'scalar-array';
  /** 数字字段的 Zod 约束类型；CLI 用于区分严格整数与有限 decimal 解析。 */
  numericKind?: 'integer' | 'decimal';
  /** 当 kind 为 object / object-array 时，递归展开后的子字段；纯展示用 */
  nested?: FieldInfo[];
}

/** Unwrap wrapper types (Optional, Nullable, Default, Effects/preprocess) */
function unwrap(schema: z.ZodTypeAny): z.ZodTypeAny {
  const def = schema._def as Record<string, unknown>;
  const typeName = def['typeName'] as string | undefined;
  if (typeName === 'ZodOptional' || typeName === 'ZodNullable' || typeName === 'ZodDefault') {
    return unwrap(def['innerType'] as z.ZodTypeAny);
  }
  if (typeName === 'ZodEffects') {
    return unwrap(def['schema'] as z.ZodTypeAny);
  }
  return schema;
}

/** 区分带 `.int()` check 的 ZodNumber 与普通 decimal number。 */
function getNumericKind(schema: z.ZodTypeAny): FieldInfo['numericKind'] {
  const inner = unwrap(schema);
  const def = inner._def as Record<string, unknown>;
  if (def['typeName'] !== 'ZodNumber') return undefined;
  const checks = Array.isArray(def['checks']) ? def['checks'] : [];
  return checks.some(
    (check) =>
      typeof check === 'object' &&
      check !== null &&
      (check as Record<string, unknown>)['kind'] === 'int'
  )
    ? 'integer'
    : 'decimal';
}

/** Get a human-readable type name from a Zod schema */
export function getZodTypeName(schema: z.ZodTypeAny): string {
  const inner = unwrap(schema);
  const def = inner._def as Record<string, unknown>;
  const typeName = def['typeName'] as string | undefined;

  switch (typeName) {
    case 'ZodString':
      return 'string';
    case 'ZodNumber':
      return 'number';
    case 'ZodBoolean':
      return 'boolean';
    case 'ZodArray': {
      const itemType = getZodTypeName(def['type'] as z.ZodTypeAny);
      return `${itemType}[]`;
    }
    case 'ZodEnum':
      return `enum(${(def['values'] as string[]).join('|')})`;
    case 'ZodLiteral':
      return `literal(${String(def['value'])})`;
    case 'ZodRecord':
      return 'object';
    case 'ZodObject':
      return 'object';
    case 'ZodUnion':
      return 'union';
    default:
      return typeName?.replace('Zod', '').toLowerCase() ?? 'unknown';
  }
}

/** Check if a Zod field is optional (has .optional(), .default(), or nullable+optional) */
export function isFieldOptional(schema: z.ZodTypeAny): boolean {
  const def = schema._def as Record<string, unknown>;
  const typeName = def['typeName'] as string | undefined;

  if (typeName === 'ZodOptional' || typeName === 'ZodDefault') return true;
  if (typeName === 'ZodNullable') return isFieldOptional(def['innerType'] as z.ZodTypeAny);
  if (typeName === 'ZodEffects') return isFieldOptional(def['schema'] as z.ZodTypeAny);
  return false;
}

/** 分类字段形态并在 object/object-array 情况下递归出 nested 子字段 */
function classifyField(fieldSchema: z.ZodTypeAny): {
  kind: FieldInfo['kind'];
  nested?: FieldInfo[];
} {
  const inner = unwrap(fieldSchema);
  const def = inner._def as Record<string, unknown>;
  const typeName = def['typeName'] as string | undefined;

  if (typeName === 'ZodObject') {
    return { kind: 'object', nested: extractFields(inner) };
  }
  if (typeName === 'ZodArray') {
    const itemRaw = def['type'] as z.ZodTypeAny;
    const itemInner = unwrap(itemRaw);
    const itemDef = itemInner._def as Record<string, unknown>;
    if ((itemDef['typeName'] as string | undefined) === 'ZodObject') {
      return { kind: 'object-array', nested: extractFields(itemInner) };
    }
    return { kind: 'scalar-array' };
  }
  return { kind: 'scalar' };
}

/** Extract field info from a ZodObject schema（object/object-array 字段会递归出 nested） */
export function extractFields(schema: z.ZodTypeAny): FieldInfo[] {
  // Handle ZodObject directly, or unwrap effects/intersections
  const inner = unwrap(schema);
  const def = inner._def as Record<string, unknown>;
  if (def['typeName'] !== 'ZodObject') return [];

  const shape = (inner as z.ZodObject<z.ZodRawShape>).shape;
  return Object.entries(shape).map(([name, fieldSchema]) => {
    const zod = fieldSchema as z.ZodTypeAny;
    const { kind, nested } = classifyField(zod);
    const info: FieldInfo = {
      name,
      type: getZodTypeName(zod),
      required: !isFieldOptional(zod),
      kind,
    };
    const numericKind = getNumericKind(zod);
    if (numericKind) info.numericKind = numericKind;
    if (nested) info.nested = nested;
    return info;
  });
}

// ── Output helpers ──────────────────────────────────────────────────

/** Print JSON to stdout */
export function printJson(data: unknown, compact = false): void {
  console.log(JSON.stringify(redactSensitive(data), null, compact ? undefined : 2));
}

/** printTable 最多显示多少行，超出截断并附尾行提示。 */
export const MAX_DISPLAY_ROWS = 50;

/** Print a simple table (for --format table) */
export function printTable(
  rows: Record<string, unknown>[],
  columns?: string[],
  options?: { displayName?: (entity: Record<string, unknown>) => string }
): void {
  if (rows.length === 0) {
    console.log('(empty)');
    return;
  }

  // 若调用方提供 displayName 派生函数，注入虚拟列 `_display` 作为表格首列，
  // 让 list 输出能在编号之外多一列业务可读名，便于人眼区分同金额/同日期实体。
  const displayFn = options?.displayName;
  const enriched: Record<string, unknown>[] = displayFn
    ? rows.map((r) => ({ _display: displayFn(r), ...r }))
    : rows;

  const baseCols = columns ?? Object.keys(enriched[0]!).slice(0, 8);
  const cols = displayFn && !baseCols.includes('_display') ? ['_display', ...baseCols] : baseCols;
  const widths = cols.map((col) => {
    const maxDataWidth = enriched
      .slice(0, MAX_DISPLAY_ROWS) // sample first N rows for width calculation
      .reduce((max, row) => Math.max(max, String(row[col] ?? '').length), 0);
    return Math.min(Math.max(col.length, maxDataWidth), 40); // cap at 40 chars
  });

  const header = cols.map((c, i) => c.padEnd(widths[i]!)).join(' | ');
  const sep = widths.map((w) => '-'.repeat(w)).join('-+-');
  const visible = enriched.slice(0, MAX_DISPLAY_ROWS);
  const body = visible.map((row) =>
    cols
      .map((c, i) =>
        String(row[c] ?? '')
          .slice(0, 40)
          .padEnd(widths[i]!)
      )
      .join(' | ')
  );

  console.log(header);
  console.log(sep);
  body.forEach((line) => console.log(line));

  if (enriched.length > MAX_DISPLAY_ROWS) {
    const omitted = enriched.length - MAX_DISPLAY_ROWS;
    console.log(`... (${omitted} more rows omitted, use --format json for full output)`);
  }
}

/** Format and output data based on --format flag */
export function output(
  data: unknown,
  format: string,
  opts?: {
    columns?: string[];
    quiet?: boolean;
    /** 业务实体显示名派生函数（仅 table 模式生效，作为首列注入） */
    displayName?: (entity: Record<string, unknown>) => string;
  }
): void {
  if (opts?.quiet && Array.isArray(data)) {
    // Quiet mode: just print IDs
    for (const item of data) {
      if (typeof item === 'object' && item !== null && 'id' in item) {
        console.log((item as { id: string }).id);
      }
    }
    return;
  }

  if (format === 'table') {
    // table 模式接受三种 data 形态：
    //  1. 数组（list 子命令 --quiet 旁路）
    //  2. 单对象（get 子命令）
    //  3. 分页对象 { items, total, page, pageSize, totalPages }（list 子命令默认）
    let rows: Record<string, unknown>[];
    if (Array.isArray(data)) {
      rows = data as Record<string, unknown>[];
    } else if (
      data &&
      typeof data === 'object' &&
      'items' in data &&
      Array.isArray((data as { items: unknown }).items)
    ) {
      rows = (data as { items: Record<string, unknown>[] }).items;
    } else {
      rows = [data as Record<string, unknown>];
    }
    printTable(rows, opts?.columns, { displayName: opts?.displayName });
  } else {
    printJson(data);
  }
}

export const CLI_EXIT_CODES = {
  SUCCESS: 0,
  USAGE: 2,
  AUTH: 3,
  PERMISSION: 4,
  CONFLICT: 5,
  NOT_FOUND: 6,
  FAILURE: 1,
  TEMPORARY: 75,
} as const;

export type CliErrorCode =
  | 'USAGE'
  | 'VALIDATION'
  | 'AUTHENTICATION'
  | 'PERMISSION_DENIED'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'RATE_LIMITED'
  | 'TEMPORARY_FAILURE'
  | 'NETWORK_ERROR'
  | 'API_ERROR'
  | 'INTERNAL_ERROR';

export interface CliErrorOptions {
  code?: CliErrorCode;
  status?: number;
  retryable?: boolean;
  retryAfterMs?: number;
  exitCode?: number;
  details?: unknown;
}

const SENSITIVE_KEY = /(?:password|passwd|secret|token|authorization|cookie|api[-_]?key)/i;

/** Recursively redact credential-like fields before any diagnostic/dry-run output. */
export function redactSensitive(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactSensitive);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      out[key] = SENSITIVE_KEY.test(key) ? '[REDACTED]' : redactSensitive(child);
    }
    return out;
  }
  return value;
}

function inferErrorOptions(
  message: string
): Required<Pick<CliErrorOptions, 'code' | 'retryable' | 'exitCode'>> {
  if (/permission denied/i.test(message)) {
    return { code: 'PERMISSION_DENIED', retryable: false, exitCode: CLI_EXIT_CODES.PERMISSION };
  }
  if (/auth|logged in|session expired|credential/i.test(message)) {
    return { code: 'AUTHENTICATION', retryable: false, exitCode: CLI_EXIT_CODES.AUTH };
  }
  if (/not found/i.test(message)) {
    return { code: 'NOT_FOUND', retryable: false, exitCode: CLI_EXIT_CODES.NOT_FOUND };
  }
  if (/conflict|version mismatch/i.test(message)) {
    return { code: 'CONFLICT', retryable: false, exitCode: CLI_EXIT_CODES.CONFLICT };
  }
  if (
    /invalid|missing|required|validation|unknown option|no fields|insecure|forbidden|only https|configure origin/i.test(
      message
    )
  ) {
    return { code: 'VALIDATION', retryable: false, exitCode: CLI_EXIT_CODES.USAGE };
  }
  return { code: 'INTERNAL_ERROR', retryable: false, exitCode: CLI_EXIT_CODES.FAILURE };
}

export class CliError extends Error {
  readonly code: CliErrorCode;
  readonly status?: number;
  readonly retryable: boolean;
  readonly retryAfterMs?: number;
  readonly exitCode: number;
  readonly details?: unknown;

  constructor(message: string, options: CliErrorOptions = {}) {
    super(message);
    this.name = 'CliError';
    const inferred = inferErrorOptions(message);
    this.code = options.code ?? inferred.code;
    this.status = options.status;
    this.retryable = options.retryable ?? inferred.retryable;
    this.retryAfterMs = options.retryAfterMs;
    this.exitCode = options.exitCode ?? inferred.exitCode;
    this.details = options.details;
  }
}

export function isRetryableError(error: unknown): error is CliError {
  return error instanceof CliError && error.retryable;
}

/** Write the stable machine-readable stderr envelope once and set the process exit code. */
export function reportCliError(error: unknown): void {
  const cliError =
    error instanceof CliError
      ? error
      : new CliError(error instanceof Error ? error.message : String(error), {
          code: 'INTERNAL_ERROR',
          retryable: false,
          exitCode: CLI_EXIT_CODES.FAILURE,
        });
  const envelope: Record<string, unknown> = {
    error: {
      code: cliError.code,
      message: cliError.message,
      retryable: cliError.retryable,
      ...(cliError.status === undefined ? {} : { status: cliError.status }),
      ...(cliError.retryAfterMs === undefined ? {} : { retryAfterMs: cliError.retryAfterMs }),
      ...(cliError.details === undefined ? {} : { details: redactSensitive(cliError.details) }),
    },
  };
  process.stderr.write(`${JSON.stringify(envelope)}\n`);
  process.exitCode = cliError.exitCode;
}

/** Throw a structured CLI error. Top-level parsing owns stderr and exit-code emission. */
export function fatal(message: string, details?: unknown, options: CliErrorOptions = {}): never {
  throw new CliError(message, { ...options, details: details ?? options.details });
}

// ── Secret input helpers ────────────────────────────────────────────

function assertRestrictedSecretFile(filePath: string): void {
  const stat = fs.lstatSync(filePath);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    fatal('Invalid secret file', 'Secret input must be a regular, non-symlink file');
  }
  if (process.platform !== 'win32' && (stat.mode & 0o077) !== 0) {
    fatal('Unsafe secret file permissions', {
      path: filePath,
      mode: `0${(stat.mode & 0o777).toString(8)}`,
      expected: '0600 or stricter',
    });
  }
}

/** Reject credential-bearing JSON from permissive files; stdin or mode 0600 files are allowed. */
export function assertSensitiveJsonSource(source: string, value: unknown): void {
  const containsSensitive = (candidate: unknown): boolean => {
    if (Array.isArray(candidate)) return candidate.some(containsSensitive);
    if (!candidate || typeof candidate !== 'object') return false;
    return Object.entries(candidate as Record<string, unknown>).some(
      ([key, child]) => SENSITIVE_KEY.test(key) || containsSensitive(child)
    );
  };
  if (!containsSensitive(value) || source === '-') return;
  try {
    assertRestrictedSecretFile(path.resolve(source));
  } catch (error) {
    if (error instanceof CliError) throw error;
    fatal('Failed to inspect credential-bearing JSON file', {
      path: source,
      reason: error instanceof Error ? error.message : String(error),
    });
  }
}

async function readHiddenTty(prompt: string): Promise<string> {
  if (!process.stdin.isTTY || !process.stdout.isTTY || !process.stdin.setRawMode) {
    fatal('Secret input required in non-interactive mode', {
      accepted: ['--password-stdin', '--password-file <mode-0600-file>'],
    });
  }
  process.stdout.write(prompt);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding('utf8');
  return new Promise<string>((resolve, reject) => {
    let value = '';
    const cleanup = (): void => {
      process.stdin.off('data', onData);
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdout.write('\n');
    };
    const onData = (chunk: string | Buffer): void => {
      const text = String(chunk);
      for (const char of text) {
        if (char === '\u0003') {
          cleanup();
          reject(new CliError('Secret input cancelled', { code: 'USAGE', exitCode: 2 }));
          return;
        }
        if (char === '\r' || char === '\n') {
          cleanup();
          resolve(value);
          return;
        }
        if (char === '\u007f' || char === '\b') {
          value = value.slice(0, -1);
        } else if (char >= ' ') {
          value += char;
        }
      }
    };
    process.stdin.on('data', onData);
  });
}

export async function readSecret(options: {
  stdin?: boolean;
  file?: string;
  prompt?: string;
  label?: string;
}): Promise<string> {
  if (options.stdin && options.file) {
    fatal(`Choose exactly one ${options.label ?? 'secret'} source`);
  }
  let value: string;
  if (options.stdin) {
    if (process.stdin.isTTY) fatal('--password-stdin requires piped stdin, not a TTY');
    value = fs.readFileSync(0, 'utf8').replace(/[\r\n]+$/, '');
  } else if (options.file) {
    assertRestrictedSecretFile(path.resolve(options.file));
    value = fs.readFileSync(options.file, 'utf8').replace(/[\r\n]+$/, '');
  } else {
    value = await readHiddenTty(options.prompt ?? 'Password: ');
  }
  if (value.length === 0) fatal(`${options.label ?? 'Secret'} must not be empty`);
  return value;
}

// ── JSON input helpers ──────────────────────────────────────────────

/**
 * 从文件或 stdin 读 JSON。
 *  - `-`：从 stdin 读取（适合 pipe）
 *  - 其他：当作文件路径读取
 * 解析失败时 fatal()，调用方拿到的一定是合法 JSON 值。
 *
 * 历史上此函数为 crud.ts 内部 helper，后续 holidays publish / customers batch /
 * payments refund 等命令都需要复用，故抽到 utils 供全 CLI 模块共享。
 */
export function readJsonInput(source: string, fieldLabel: string): unknown {
  let raw: string;
  try {
    if (source === '-') {
      raw = fs.readFileSync(0, 'utf-8');
    } else {
      raw = fs.readFileSync(source, 'utf-8');
    }
  } catch (err) {
    fatal(`Failed to read ${fieldLabel} from ${source === '-' ? 'stdin' : source}`, {
      reason: err instanceof Error ? err.message : String(err),
    });
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    assertSensitiveJsonSource(source, parsed);
    return parsed;
  } catch (err) {
    if (err instanceof CliError) throw err;
    fatal(`Invalid JSON for ${fieldLabel} (${source === '-' ? 'stdin' : source})`, {
      reason: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * 读 JSON + 用 shared zod schema 校验，确保 CLI 端 dry-run 输出与服务端校验语义一致。
 * 校验失败时 fatal() 输出结构化 Zod issues（path + message），AI Agent 调用方可直接解析。
 *
 * 这是 CLI 写入命令的标准 body 入口——避免出现"CLI 顶层 typeof object 检查通过，但
 * 业务字段 / superRefine 不过、dry-run 已经把请求体打印成可发送"的窗口期 bug。
 *
 * 使用方式：
 *   const body = parseJsonWithSchema(createPaymentRefundSchema, opts.json, '--json');
 */
export function parseJsonWithSchema<T extends z.ZodTypeAny>(
  schema: T,
  source: string,
  fieldLabel: string
): z.infer<T> {
  const parsed = readJsonInput(source, fieldLabel);
  const result = schema.safeParse(parsed);
  if (!result.success) {
    fatal(`Validation failed for ${fieldLabel}`, {
      source: source === '-' ? 'stdin' : source,
      issues: result.error.issues.map((i) => ({
        path: i.path.join('.') || '(root)',
        code: i.code,
        message: i.message,
      })),
    });
  }
  return result.data;
}

/**
 * 把扁平 option 组装的对象直接用 shared zod schema 校验。
 * 与 parseJsonWithSchema 互补：前者用于 `--json` 输入，后者用于 `--field` flag 组装。
 * 校验失败同样走结构化 fatal()。
 */
export function validateWithSchema<T extends z.ZodTypeAny>(
  schema: T,
  data: unknown,
  fieldLabel: string
): z.infer<T> {
  const result = schema.safeParse(data);
  if (!result.success) {
    fatal(`Validation failed for ${fieldLabel}`, {
      issues: result.error.issues.map((i) => ({
        path: i.path.join('.') || '(root)',
        code: i.code,
        message: i.message,
      })),
    });
  }
  return result.data;
}

const uuidPathIdSchema = z.string().uuid();

/**
 * 所有 CRUD 路径参数统一遵循实体 UUID 契约：先 safeParse，成功后才 URL 编码。
 * 这样 `../`、斜杠、查询串、空白等输入不会在 dry-run 或 HTTP client 前穿透路径边界。
 */
export function encodeUuidPathId(value: string, fieldLabel = 'id'): string {
  const parsed = uuidPathIdSchema.safeParse(value);
  if (!parsed.success) {
    fatal(`Invalid ${fieldLabel} "${value}"`, 'Expected a canonical UUID entity ID');
  }
  return encodeURIComponent(parsed.data);
}

/**
 * 严格整数解析：只接受 safe integer 的纯数字字符串，拒绝 "1abc" / "0x10" / "1e3" / "1.5" / 空串。
 * commander 默认的 Number() / parseInt() 会接受前缀数字（"2026abc" → 2026），
 * 在 CLI 边界处用此 helper 提前 fail-fast。
 */
export function parseStrictInt(value: string, fieldLabel: string): number {
  if (!/^-?\d+$/.test(value)) {
    fatal(`Invalid ${fieldLabel} "${value}"`, 'Expected integer (no prefix/suffix)');
  }
  const n = Number(value);
  if (!Number.isSafeInteger(n)) {
    fatal(`Invalid ${fieldLabel} "${value}"`, 'Expected safe integer');
  }
  return n;
}

export function parsePositiveInt(value: string, fieldLabel: string): number {
  const parsed = parseStrictInt(value, fieldLabel);
  if (parsed < 1) fatal(`Invalid ${fieldLabel} "${value}"`, 'Expected a positive integer (>= 1)');
  return parsed;
}

/** Parse a timezone-qualified ISO 8601 instant and return its canonical representation. */
export function parseIsoInstant(value: string, fieldLabel: string): string {
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
  ) {
    fatal(
      `Invalid ${fieldLabel} "${value}"`,
      'Expected ISO 8601 date-time with Z or numeric timezone offset'
    );
  }
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    fatal(`Invalid ${fieldLabel} "${value}"`, 'Expected a real calendar date-time');
  }
  return new Date(timestamp).toISOString();
}
