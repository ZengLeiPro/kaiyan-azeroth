import fs from 'node:fs';
import path from 'node:path';
import { finished } from 'node:stream/promises';

import { request, setHttpTimeoutMs } from '../client.js';
import { camelToKebab, CLI_EXIT_CODES, CliError, fatal, isRetryableError } from '../utils.js';

// ── Constants ───────────────────────────────────────────────────────

/** 指数退避重试间隔（ms）。共 4 次重试。 */
const RETRY_DELAYS_MS = [500, 2000, 5000, 10000] as const;

/** --all 模式的 HTTP timeout（ms）。比默认 30s 大，应对网络波动。 */
const ALL_MODE_TIMEOUT_MS = 120_000;
/** 防止错误的 hasMore 或被忽略的页码造成无界循环。 */
export const MAX_ALL_PAGES = 100_000;

/** 防止恶意/错误 Retry-After 让 Agent 长时间挂起。 */
export const MAX_SINGLE_RETRY_WAIT_MS = 60_000;
export const MAX_TOTAL_RETRY_WAIT_MS = 90_000;

export function computeRetryWaitMs(
  baseDelayMs: number,
  retryAfterMs: number | undefined,
  totalWaitMs: number,
  random = Math.random
): number | null {
  const jitterRatio = Math.min(1, Math.max(0, random()));
  const jitteredBase = baseDelayMs + Math.floor(baseDelayMs * 0.1 * jitterRatio);
  const delay = Math.max(jitteredBase, retryAfterMs ?? 0);
  if (
    !Number.isSafeInteger(delay) ||
    delay < 0 ||
    delay > MAX_SINGLE_RETRY_WAIT_MS ||
    totalWaitMs + delay > MAX_TOTAL_RETRY_WAIT_MS
  ) {
    return null;
  }
  return delay;
}

export interface RetryWaitBudget {
  totalWaitMs: number;
}

/** Reserve wait time against the budget shared by one complete --all invocation. */
export function reserveRetryWaitMs(
  baseDelayMs: number,
  retryAfterMs: number | undefined,
  budget: RetryWaitBudget,
  random = Math.random
): number | null {
  const delay = computeRetryWaitMs(baseDelayMs, retryAfterMs, budget.totalWaitMs, random);
  if (delay !== null) budget.totalWaitMs += delay;
  return delay;
}

// ── Types ───────────────────────────────────────────────────────────

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  /** 服务端明确给出时优先于 totalPages/items.length 判停。 */
  hasMore?: boolean;
}

export interface RunAllPagesResult {
  startPage: number;
  lastPage: number;
  pagesFetched: number;
  totalItems: number;
  snapshotAt: string;
}

export interface RunAllPagesParams<T = Record<string, unknown>> {
  /** 默认 GET 模式的 API 路径，例如 `/customers`。 */
  apiPath?: string;
  /** 每页条数，透传给后端 `pageSize`。 */
  pageSize: number;
  /** 默认 GET 模式的其它 query 参数，不含 page/pageSize。 */
  queryParams?: Record<string, unknown>;
  /** 自定义单页请求；用于 POST 分页等非标准查询。 */
  requestPage?: (page: number, pageSize: number) => Promise<PaginatedResponse<T>>;
  /** 输出文件路径；未指定写 stdout。 */
  output?: string;
  /** 从指定页开始拉（失败续传用）。 */
  resumeFromPage?: number;
  /** 实体名，用于进度日志。 */
  entityName: string;
  /** 自定义失败续传命令。 */
  resumeCommand?: (page: number) => string;
  /** 单行成功写入后回调，用于维护可续传的内容摘要。 */
  onItemWritten?: (item: T, serializedLine: string) => void | Promise<void>;
  /** 每页完整写入后回调，用于持久化元数据 sidecar。 */
  onPage?: (response: PaginatedResponse<T>) => void | Promise<void>;
}

// ── Helpers ─────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function logProgress(msg: string): void {
  // 所有进度与元信息都到 stderr，stdout 保持纯 NDJSON
  process.stderr.write(`[azeroth] ${msg}\n`);
}

function shellQuote(value: string): string {
  if (/^[A-Za-z0-9_./:=@+-]+$/.test(value)) return value;
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function formatResumeQueryArgs(queryParams: Record<string, unknown>): string {
  const args: string[] = [];
  for (const [key, rawValue] of Object.entries(queryParams)) {
    if (rawValue === undefined || rawValue === null) continue;

    const flag = `--${camelToKebab(key)}`;
    if (Array.isArray(rawValue)) {
      for (const item of rawValue) {
        if (item === undefined || item === null || item === '') continue;
        args.push(flag, shellQuote(String(item)));
      }
      continue;
    }

    if (typeof rawValue === 'boolean') {
      if (rawValue) args.push(flag);
      continue;
    }

    if (rawValue === '') continue;
    args.push(flag, shellQuote(String(rawValue)));
  }

  return args.length > 0 ? ` ${args.join(' ')}` : '';
}

function assertPageResponse<T>(
  response: PaginatedResponse<T>,
  requestedPage: number,
  requestedPageSize: number
): void {
  if (!response || typeof response !== 'object' || !Array.isArray(response.items)) {
    fatal('Invalid paginated response', 'Expected an object with an items array');
  }
  if (response.page !== requestedPage) {
    fatal('Paginated response page mismatch', {
      requestedPage,
      actualPage: response.page,
    });
  }
  if (response.pageSize !== requestedPageSize) {
    fatal('Paginated response pageSize mismatch', {
      requestedPageSize,
      actualPageSize: response.pageSize,
    });
  }
  if (!Number.isSafeInteger(response.total) || response.total < 0) {
    fatal('Invalid paginated response total', response.total);
  }
  if (!Number.isSafeInteger(response.totalPages) || response.totalPages < 0) {
    fatal('Invalid paginated response totalPages', response.totalPages);
  }
  if (response.hasMore !== undefined && typeof response.hasMore !== 'boolean') {
    fatal('Invalid paginated response hasMore', response.hasMore);
  }
}

/**
 * 拉单页，失败时按 RETRY_DELAYS_MS 指数退避重试。
 * 所有重试耗尽后抛出最后一次错误（交由上层决定续传 or fatal）。
 */
async function fetchPageWithRetry<T>(
  requestPage: () => Promise<PaginatedResponse<T>>,
  page: number,
  entityName: string,
  retryWaitBudget: RetryWaitBudget
): Promise<PaginatedResponse<T>> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    try {
      return await requestPage();
    } catch (err) {
      lastError = err;
      // Deterministic 4xx failures (400/401/403/404/409/422) fail immediately.
      if (!isRetryableError(err) || attempt >= RETRY_DELAYS_MS.length) throw err;
      const baseDelay = RETRY_DELAYS_MS[attempt]!;
      const retryAfterMs = err instanceof CliError ? err.retryAfterMs : undefined;
      // Retry-After is authoritative when longer than local backoff，但单次和累计等待均受安全预算约束。
      const delay = reserveRetryWaitMs(baseDelay, retryAfterMs, retryWaitBudget);
      if (delay === null) {
        throw new CliError('Retry wait exceeds --all safety budget', {
          code: 'TEMPORARY_FAILURE',
          status: err.status,
          retryable: false,
          retryAfterMs,
          exitCode: CLI_EXIT_CODES.TEMPORARY,
          details: {
            page,
            maxSingleWaitMs: MAX_SINGLE_RETRY_WAIT_MS,
            maxTotalWaitMs: MAX_TOTAL_RETRY_WAIT_MS,
            totalWaitMs: retryWaitBudget.totalWaitMs,
          },
        });
      }
      logProgress(
        `Page ${page} failed (attempt ${attempt + 1}/${
          RETRY_DELAYS_MS.length + 1
        }, status=${err.status ?? 'network'}, retryable=true), retrying in ${delay}ms... [${entityName}]`
      );
      await sleep(delay);
    }
  }
  throw lastError;
}

// ── Public API ──────────────────────────────────────────────────────

/**
 * 串行翻页拉取指定 endpoint 的全量数据，输出为 NDJSON（每行一个 JSON 对象）。
 *
 * 设计要点：
 * - **串行**：避免对 RDS 造成并发压力
 * - **重试**：单页失败时 [500/2000/5000/10000]ms 指数退避 4 次
 * - **NDJSON 输出**：DuckDB 原生支持 `read_json_auto('file.ndjson', format='newline_delimited')`
 * - **resume 机制**：取页、写盘或 sidecar 失败时均打印检查点后的续传命令
 * - **判停**：优先使用 `hasMore`，否则按 `totalPages` 与页长度双重保险，并设页数安全上限
 * - **snapshot_at**：完成时 stderr 末行输出 ISO 时间戳，skill 层据此记录快照时间
 */
export async function runAllPages<T = Record<string, unknown>>(
  params: RunAllPagesParams<T>
): Promise<RunAllPagesResult> {
  const {
    apiPath,
    pageSize,
    queryParams = {},
    requestPage,
    output,
    resumeFromPage,
    entityName,
    resumeCommand,
    onItemWritten,
    onPage,
  } = params;
  if (!requestPage && !apiPath) {
    fatal('runAllPages requires apiPath or requestPage');
  }

  // 运行时放宽 HTTP timeout，应对慢查询
  setHttpTimeoutMs(ALL_MODE_TIMEOUT_MS);

  let writer: fs.WriteStream | null = null;
  let writerError: Error | null = null;
  if (output) {
    fs.mkdirSync(path.dirname(output), { recursive: true });
    // resumeFromPage > 1 时 append，否则 truncate 重写
    const flags = (resumeFromPage ?? 1) > 1 ? 'a' : 'w';
    writer = fs.createWriteStream(output, { flags, encoding: 'utf-8' });
    writer.on('error', (error) => {
      writerError = error;
    });
    logProgress(`Output → ${output} (${flags === 'a' ? 'append (resume)' : 'overwrite'})`);
  }

  const writeLine = (line: string): Promise<void> => {
    if (!writer) {
      process.stdout.write(line);
      return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
      writer!.write(line, (error) => (error ? reject(error) : resolve()));
    });
  };

  const startPage = resumeFromPage ?? 1;
  let page = startPage;
  let pagesFetched = 0;
  let totalItems = 0;
  let totalPages: number | null = null;
  let firstPage = true;
  let resumePage = startPage;
  // One --all command owns one budget; successful page transitions do not reset it.
  const retryWaitBudget: RetryWaitBudget = { totalWaitMs: 0 };

  try {
    while (true) {
      resumePage = page;
      const resp = await fetchPageWithRetry<T>(
        () =>
          requestPage
            ? requestPage(page, pageSize)
            : request<PaginatedResponse<T>>('GET', apiPath!, undefined, {
                ...queryParams,
                page,
                pageSize,
              }),
        page,
        entityName,
        retryWaitBudget
      );
      assertPageResponse(resp, page, pageSize);

      if (firstPage) {
        totalPages = resp.totalPages;
        logProgress(
          `Starting ${entityName}: total=${resp.total}, totalPages=${resp.totalPages}, pageSize=${pageSize}` +
            (startPage > 1 ? ` (resume from page ${startPage})` : '')
        );
        firstPage = false;
      }

      const items = resp.items;
      for (const item of items) {
        const line = JSON.stringify(item) + '\n';
        await writeLine(line);
        await onItemWritten?.(item, line);
      }
      totalItems += items.length;
      await onPage?.(resp);
      pagesFetched++;
      resumePage = page + 1;

      logProgress(`Fetched page ${page}/${totalPages ?? '?'} (items=${totalItems}/${resp.total})`);

      // hasMore 是数据集服务的权威判定；标准 CRUD 响应没有该字段时保留双保险。
      const shouldStop =
        resp.hasMore === false ||
        (resp.hasMore !== true && totalPages !== null && page >= totalPages) ||
        (resp.hasMore !== true && items.length < pageSize);
      if (shouldStop) break;
      if (pagesFetched >= MAX_ALL_PAGES) {
        fatal('Exceeded --all page safety limit', {
          maxPages: MAX_ALL_PAGES,
          lastCompletedPage: page,
        });
      }

      page++;
    }

    if (writer) {
      writer.end();
      await finished(writer);
      if (writerError) throw writerError;
    }

    const snapshotAt = new Date().toISOString();
    logProgress(`Done. snapshot_at=${snapshotAt} total=${totalItems}`);
    return {
      startPage,
      lastPage: page,
      pagesFetched,
      totalItems,
      snapshotAt,
    };
  } catch (err) {
    if (writer && !writer.closed) {
      writer.destroy();
      await finished(writer).catch(() => undefined);
    }
    logProgress(`FAILED at page ${resumePage}. Partial output preserved.`);
    const defaultResume = `azeroth ${entityName} list --all --page-size ${pageSize}${formatResumeQueryArgs(
      queryParams
    )} --resume-from-page ${resumePage}${output ? ` --output ${output}` : ''}`;
    logProgress(`Resume with: ${resumeCommand?.(resumePage) ?? defaultResume}`);
    if (err instanceof CliError) throw err;
    const msg = err instanceof Error ? err.message : String(err);
    fatal(`runAllPages failed at page ${resumePage}`, msg);
  }
}
