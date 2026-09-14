import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { refreshTokenResponseSchema } from '@ky-azeroth/shared';
import axios, { AxiosError, AxiosInstance } from 'axios';

import { CLI_EXIT_CODES, CliError, type CliErrorCode, fatal } from './utils.js';

// ── Auth storage ────────────────────────────────────────────────────

const CONFIG_DIR = path.join(os.homedir(), '.azeroth-cli');
const AUTH_FILE = path.join(CONFIG_DIR, 'auth.json');
const AUTH_LOCK_DIR = path.join(CONFIG_DIR, '.auth.lock');
const AUTH_LOCK_TIMEOUT_MS = 35_000;
const AUTH_LOCK_STALE_MS = 60_000;
const AUTH_LOCK_OWNER_PATTERN = /^owner-(\d+)-([0-9a-f-]{36})\.json$/;

export interface StoredAuth {
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // Unix timestamp in ms
  user: {
    id: string;
    username: string;
    employee?: { id: string; name: string } | null;
  };
}

function ensureConfigDir(): void {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  } else {
    assertSecurePath(CONFIG_DIR, 'directory');
  }
  fs.chmodSync(CONFIG_DIR, 0o700);
}

function assertSecurePath(target: string, expected: 'file' | 'directory'): fs.Stats {
  const stat = fs.lstatSync(target);
  if (stat.isSymbolicLink()) throw new Error(`拒绝使用符号链接凭据路径: ${target}`);
  assertSecureStats(stat, target, expected);
  return stat;
}

function assertSecureStats(stat: fs.Stats, target: string, expected: 'file' | 'directory'): void {
  if (expected === 'file' ? !stat.isFile() : !stat.isDirectory()) {
    throw new Error(`凭据路径类型不正确: ${target}`);
  }
  if (typeof process.getuid === 'function' && stat.uid !== process.getuid()) {
    throw new Error(`凭据路径不属于当前用户: ${target}`);
  }
}

export function loadAuth(): StoredAuth | null {
  if (!fs.existsSync(AUTH_FILE)) return null;
  assertSecurePath(CONFIG_DIR, 'directory');
  assertSecurePath(AUTH_FILE, 'file');
  fs.chmodSync(CONFIG_DIR, 0o700);
  let descriptor: number | null = null;
  try {
    descriptor = fs.openSync(AUTH_FILE, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
    assertSecureStats(fs.fstatSync(descriptor), AUTH_FILE, 'file');
    fs.fchmodSync(descriptor, 0o600);
    const data = JSON.parse(fs.readFileSync(descriptor, 'utf-8')) as StoredAuth;
    return data;
  } catch {
    return null;
  } finally {
    if (descriptor !== null) fs.closeSync(descriptor);
  }
}

export function saveAuth(auth: StoredAuth): void {
  ensureConfigDir();
  if (fs.existsSync(AUTH_FILE)) assertSecurePath(AUTH_FILE, 'file');

  const tempFile = path.join(CONFIG_DIR, `.auth-${process.pid}-${randomUUID()}.tmp`);
  let descriptor: number | null = null;
  try {
    descriptor = fs.openSync(
      tempFile,
      fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY,
      0o600
    );
    fs.writeFileSync(descriptor, JSON.stringify(auth, null, 2), 'utf8');
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = null;
    fs.renameSync(tempFile, AUTH_FILE);
    fs.chmodSync(AUTH_FILE, 0o600);
  } catch (error) {
    if (descriptor !== null) fs.closeSync(descriptor);
    if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
    throw error;
  }
}

export function clearAuth(): void {
  if (!fs.existsSync(AUTH_FILE)) return;
  assertSecurePath(CONFIG_DIR, 'directory');
  assertSecurePath(AUTH_FILE, 'file');
  fs.unlinkSync(AUTH_FILE);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface PreparedAuthLock {
  candidateDir: string;
  ownerMarkerName: string;
}

function prepareAuthLock(): PreparedAuthLock {
  const token = randomUUID();
  const ownerMarkerName = `owner-${process.pid}-${token}.json`;
  const candidateDir = path.join(CONFIG_DIR, `.auth-lock-candidate-${process.pid}-${token}`);
  fs.mkdirSync(candidateDir, { mode: 0o700 });
  fs.writeFileSync(
    path.join(candidateDir, ownerMarkerName),
    JSON.stringify({ pid: process.pid, token }),
    { encoding: 'utf8', flag: 'wx', mode: 0o600 }
  );
  return { candidateDir, ownerMarkerName };
}

function removePreparedAuthLock(lock: PreparedAuthLock): void {
  try {
    fs.unlinkSync(path.join(lock.candidateDir, lock.ownerMarkerName));
    fs.rmdirSync(lock.candidateDir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/**
 * 仅回收已超过 stale 阈值、且持有进程已退出的锁。
 *
 * owner marker 使用随机文件名：并发回收者或迟到的旧持有者只能删除自己观察到的
 * marker，不会在锁目录被新持有者复用后误删新锁。
 */
function reclaimStaleAuthLock(): boolean {
  const stat = assertSecurePath(AUTH_LOCK_DIR, 'directory');
  if (Date.now() - stat.mtimeMs <= AUTH_LOCK_STALE_MS) return false;

  const entries = fs.readdirSync(AUTH_LOCK_DIR);
  if (entries.length === 0) {
    // 兼容旧版本留下的空目录锁。新实现的锁在原子发布前已包含 owner marker。
    try {
      fs.rmdirSync(AUTH_LOCK_DIR);
      return true;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ENOENT' || code === 'ENOTEMPTY') return false;
      throw error;
    }
  }

  if (entries.length !== 1) {
    throw new Error(`凭据锁目录包含未知文件，拒绝自动回收: ${AUTH_LOCK_DIR}`);
  }
  const markerName = entries[0]!;
  const match = AUTH_LOCK_OWNER_PATTERN.exec(markerName);
  if (!match) {
    throw new Error(`凭据锁 owner marker 格式无效，拒绝自动回收: ${markerName}`);
  }

  const markerPath = path.join(AUTH_LOCK_DIR, markerName);
  assertSecurePath(markerPath, 'file');
  const marker = JSON.parse(fs.readFileSync(markerPath, 'utf8')) as {
    pid?: unknown;
    token?: unknown;
  };
  const pid = Number(match[1]);
  if (marker.pid !== pid || marker.token !== match[2]) {
    throw new Error(`凭据锁 owner marker 内容无效，拒绝自动回收: ${markerName}`);
  }
  if (isProcessAlive(pid)) return false;

  try {
    fs.unlinkSync(markerPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
  try {
    fs.rmdirSync(AUTH_LOCK_DIR);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || code === 'ENOTEMPTY') return false;
    throw error;
  }
}

function releaseAuthLock(ownerMarkerName: string): void {
  try {
    fs.unlinkSync(path.join(AUTH_LOCK_DIR, ownerMarkerName));
  } catch (error) {
    // 锁已被回收或路径已经属于其它 owner 时，不得继续 rmdir 新持有者的锁。
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw error;
  }
  fs.rmdirSync(AUTH_LOCK_DIR);
}

/** @internal 导出仅供跨进程互斥回归测试。 */
export async function withAuthFileLock<T>(operation: () => Promise<T>): Promise<T> {
  ensureConfigDir();
  const deadline = Date.now() + AUTH_LOCK_TIMEOUT_MS;
  const prepared = prepareAuthLock();
  let acquired = false;

  try {
    for (;;) {
      try {
        if (!fs.existsSync(AUTH_LOCK_DIR)) {
          fs.renameSync(prepared.candidateDir, AUTH_LOCK_DIR);
          acquired = true;
          break;
        }

        if (reclaimStaleAuthLock()) {
          continue;
        }
      } catch (lockError) {
        const code = (lockError as NodeJS.ErrnoException).code;
        if (code !== 'ENOENT' && code !== 'EEXIST' && code !== 'ENOTEMPTY') throw lockError;
      }

      if (Date.now() >= deadline) {
        throw new CliError('Credential update is busy; retry the command', {
          code: 'TEMPORARY_FAILURE',
          retryable: true,
          exitCode: CLI_EXIT_CODES.TEMPORARY,
        });
      }
      await delay(50);
    }

    let result: T | undefined;
    let operationError: unknown;
    try {
      result = await operation();
    } catch (error) {
      operationError = error;
    }

    let cleanupError: unknown;
    try {
      releaseAuthLock(prepared.ownerMarkerName);
    } catch (error) {
      cleanupError = error;
    }

    if (operationError !== undefined) throw operationError;
    if (cleanupError !== undefined) throw cleanupError;
    return result as T;
  } finally {
    if (!acquired) removePreparedAuthLock(prepared);
  }
}

/** 清除本地凭据时与 login/refresh 共用同一把跨进程锁。 */
export async function logout(): Promise<void> {
  await withAuthFileLock(async () => {
    clearAuth();
  });
}

// ── Base URL resolution ─────────────────────────────────────────────

function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  return (
    normalized === 'localhost' ||
    normalized === '::1' ||
    normalized === '0:0:0:0:0:0:0:1' ||
    /^127(?:\.\d{1,3}){3}$/.test(normalized)
  );
}

/**
 * API transport policy:
 * - HTTPS is required for every non-loopback host.
 * - HTTP is accepted only for localhost / 127.0.0.0/8 / ::1 development targets.
 * - credentials, query/hash and an already-appended /api/v1 suffix are rejected.
 * - deployment path prefixes are preserved (for example /ky-azeroth on the FC custom domain).
 */
export function validateApiBaseUrl(raw: string): string {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    fatal('Invalid AZEROTH_API_URL', 'Expected an absolute http(s) URL');
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    fatal('Invalid AZEROTH_API_URL protocol', 'Only https is allowed (http only for loopback)');
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    fatal('Invalid AZEROTH_API_URL', 'Credentials, query strings and fragments are forbidden');
  }
  const pathPrefix = parsed.pathname.replace(/\/+$/, '');
  if (pathPrefix.endsWith('/api/v1')) {
    fatal('Invalid AZEROTH_API_URL path', 'Do not include /api/v1; the CLI appends it');
  }
  if (parsed.protocol === 'http:' && !isLoopbackHostname(parsed.hostname)) {
    fatal('Insecure AZEROTH_API_URL refused', 'Non-loopback API targets must use HTTPS');
  }
  return `${parsed.origin}${pathPrefix}`;
}

function getBaseUrl(): string {
  return validateApiBaseUrl(process.env['AZEROTH_API_URL'] ?? 'http://localhost:3000');
}

// ── HTTP Client ─────────────────────────────────────────────────────

let _client: AxiosInstance | null = null;

function getDefaultTimeoutMs(): number {
  const raw = process.env['AZEROTH_HTTP_TIMEOUT_MS'];
  if (!raw) return 30_000;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : 30_000;
}

function appendParam(search: URLSearchParams, key: string, value: unknown): void {
  if (value === undefined || value === null) return;

  if (Array.isArray(value)) {
    for (const item of value) appendParam(search, key, item);
    return;
  }

  if (value instanceof Date) {
    search.append(key, value.toISOString());
    return;
  }

  if (typeof value === 'object') {
    for (const [childKey, childValue] of Object.entries(value as Record<string, unknown>)) {
      appendParam(search, `${key}[${childKey}]`, childValue);
    }
    return;
  }

  search.append(key, String(value));
}

function serializeParams(params: Record<string, unknown>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    appendParam(search, key, value);
  }
  return search.toString();
}

function getClient(): AxiosInstance {
  if (_client) return _client;

  _client = axios.create({
    baseURL: `${getBaseUrl()}/api/v1`,
    timeout: getDefaultTimeoutMs(),
    headers: { 'Content-Type': 'application/json' },
    // Axios 默认把数组序列化成 `field[]=a`。FC 网关 + Nest Query DTO 链路
    // 不稳定识别顶层 `[]` key，统一改成重复 key：`field=a&field=b`。
    paramsSerializer: { serialize: serializeParams },
  });

  return _client;
}

/**
 * Override the HTTP timeout for subsequent requests.
 * Used by --all mode to extend tolerance for long-running list pulls.
 */
export function setHttpTimeoutMs(ms: number): void {
  const client = getClient();
  client.defaults.timeout = ms;
}

/** Refresh the access token while the caller owns AUTH_LOCK_DIR. */
async function refreshTokenLocked(auth: StoredAuth): Promise<StoredAuth> {
  const client = getClient();
  try {
    const res = await client.post('/auth/refresh', { refreshToken: auth.refreshToken });
    const parsed = refreshTokenResponseSchema.safeParse(res.data);
    if (!parsed.success) {
      throw new CliError('Invalid token refresh response', {
        code: 'API_ERROR',
        retryable: false,
        exitCode: CLI_EXIT_CODES.FAILURE,
      });
    }

    const current = loadAuth();
    if (!current) {
      fatal('Not logged in. Run: azeroth login --username <user>');
    }
    if (current.refreshToken !== auth.refreshToken) return current;

    const updated: StoredAuth = {
      accessToken: parsed.data.accessToken,
      refreshToken: parsed.data.refreshToken,
      expiresAt: Date.now() + parsed.data.expiresIn * 1000,
      user: {
        id: parsed.data.user.id,
        username: parsed.data.user.username,
        employee: parsed.data.user.employee
          ? { id: parsed.data.user.employee.id, name: parsed.data.user.employee.name }
          : undefined,
      },
    };
    saveAuth(updated);
    return updated;
  } catch (error) {
    if (error instanceof CliError) throw error;

    const current = loadAuth();
    if (current && current.refreshToken !== auth.refreshToken) return current;

    if (error instanceof AxiosError) {
      const status = error.response?.status;
      const classification = classifyHttpStatus(status);
      if (status === 401 && current?.refreshToken === auth.refreshToken) {
        clearAuth();
        fatal('Session expired. Run: azeroth login', undefined, {
          code: 'AUTHENTICATION',
          status,
          retryable: false,
          exitCode: CLI_EXIT_CODES.AUTH,
        });
      }
      throw new CliError(classification.message, {
        code: classification.code,
        status,
        retryable: classification.retryable,
        retryAfterMs: parseRetryAfterMs(error.response?.headers?.['retry-after']),
        exitCode: classification.exitCode,
      });
    }

    throw new CliError(error instanceof Error ? error.message : String(error), {
      code: 'NETWORK_ERROR',
      retryable: true,
      exitCode: CLI_EXIT_CODES.TEMPORARY,
    });
  }
}

/**
 * Get a valid access token.
 *
 * 优先级：
 *  1. 环境变量 AZEROTH_TOKEN（PAT 长期令牌，用于 agent 平台等第三方系统）
 *     - 不走 login/refresh，直接透传到 Authorization header
 *     - 401 时不清除 ~/.azeroth-cli/auth.json（这两套凭证互不影响）
 *  2. ~/.azeroth-cli/auth.json（人工 `azeroth login` 后的短期 JWT，过期前 60s 自动 refresh）
 */
async function getValidToken(): Promise<string> {
  const envToken = process.env['AZEROTH_TOKEN'];
  if (envToken && envToken.trim().length > 0) {
    return envToken.trim();
  }

  let auth = loadAuth();
  if (!auth) {
    fatal('Not logged in. Run: azeroth login --username <user> (hidden TTY or --password-stdin)');
  }

  // Refresh if token expires within 60 seconds
  if (Date.now() > auth.expiresAt - 60_000) {
    auth = await withAuthFileLock(async () => {
      const current = loadAuth();
      if (!current) {
        fatal('Not logged in. Run: azeroth login --username <user>');
      }
      if (Date.now() <= current.expiresAt - 60_000) return current;
      return refreshTokenLocked(current);
    });
  }

  return auth.accessToken;
}

/** 当前是否走 PAT 鉴权（来自 AZEROTH_TOKEN env） */
function isUsingEnvToken(): boolean {
  const t = process.env['AZEROTH_TOKEN'];
  return !!(t && t.trim().length > 0);
}

// ── Public API ──────────────────────────────────────────────────────

export interface LoginParams {
  username: string;
  password: string;
}

export function parseRetryAfterMs(raw: string | undefined, nowMs = Date.now()): number | undefined {
  if (!raw) return undefined;
  const value = raw.trim();
  if (/^\d+$/.test(value)) return Number(value) * 1000;
  const absoluteMs = Date.parse(value);
  if (!Number.isFinite(absoluteMs)) return undefined;
  return Math.max(0, absoluteMs - nowMs);
}

export function classifyHttpStatus(status: number | undefined): {
  code: CliErrorCode;
  retryable: boolean;
  exitCode: number;
  message: string;
} {
  if (status === undefined)
    return {
      code: 'NETWORK_ERROR',
      retryable: true,
      exitCode: CLI_EXIT_CODES.TEMPORARY,
      message: 'Network request failed',
    };
  if (status === 401)
    return {
      code: 'AUTHENTICATION',
      retryable: false,
      exitCode: CLI_EXIT_CODES.AUTH,
      message: 'Authentication failed',
    };
  if (status === 403)
    return {
      code: 'PERMISSION_DENIED',
      retryable: false,
      exitCode: CLI_EXIT_CODES.PERMISSION,
      message: 'Permission denied',
    };
  if (status === 404)
    return {
      code: 'NOT_FOUND',
      retryable: false,
      exitCode: CLI_EXIT_CODES.NOT_FOUND,
      message: 'Not found',
    };
  if (status === 409)
    return {
      code: 'CONFLICT',
      retryable: false,
      exitCode: CLI_EXIT_CODES.CONFLICT,
      message: 'Conflict',
    };
  if (status === 429)
    return {
      code: 'RATE_LIMITED',
      retryable: true,
      exitCode: CLI_EXIT_CODES.TEMPORARY,
      message: 'Rate limited',
    };
  if (status === 408 || status === 425 || (status !== undefined && status >= 500))
    return {
      code: 'TEMPORARY_FAILURE',
      retryable: true,
      exitCode: CLI_EXIT_CODES.TEMPORARY,
      message: `Temporary API failure (${status})`,
    };
  if (status === 400 || status === 422)
    return {
      code: 'VALIDATION',
      retryable: false,
      exitCode: CLI_EXIT_CODES.USAGE,
      message: 'Validation error',
    };
  return {
    code: 'API_ERROR',
    retryable: false,
    exitCode: CLI_EXIT_CODES.FAILURE,
    message: `API error (${status ?? 'unknown'})`,
  };
}

export async function login(params: LoginParams): Promise<StoredAuth> {
  const client = getClient();
  const res = await client.post<{
    accessToken: string;
    refreshToken: string;
    expiresIn: number;
    user: {
      id: string;
      username: string;
      employee?: { id: string; name: string } | null;
    };
  }>('/auth/login', params);

  const auth: StoredAuth = {
    accessToken: res.data.accessToken,
    refreshToken: res.data.refreshToken,
    expiresAt: Date.now() + res.data.expiresIn * 1000,
    user: {
      id: res.data.user.id,
      username: res.data.user.username,
      employee: res.data.user.employee ?? undefined,
    },
  };
  await withAuthFileLock(async () => {
    saveAuth(auth);
  });
  return auth;
}

/** Make an authenticated API request */
export async function request<T = unknown>(
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  path: string,
  data?: Record<string, unknown>,
  params?: Record<string, unknown>
): Promise<T> {
  const token = await getValidToken();
  const client = getClient();

  try {
    const res = await client.request<T>({
      method,
      url: path,
      data: method !== 'GET' ? data : undefined,
      params: method === 'GET' ? { ...params, ...data } : params,
      headers: { Authorization: `Bearer ${token}` },
    });
    return res.data;
  } catch (err) {
    if (err instanceof AxiosError) {
      const status = err.response?.status;
      const body = err.response?.data as Record<string, unknown> | undefined;
      if (status === 401 && !isUsingEnvToken()) {
        await withAuthFileLock(async () => {
          if (loadAuth()?.accessToken === token) clearAuth();
        });
      }

      // Axios 的断链/超时同样是 AxiosError，但没有 response/status；必须进入可重试网络错误分支。
      const classification = classifyHttpStatus(status);
      const retryAfterMs = parseRetryAfterMs(err.response?.headers?.['retry-after']);
      const requestId =
        err.response?.headers?.['x-request-id'] ??
        (typeof body?.['requestId'] === 'string' ? body['requestId'] : undefined);
      throw new CliError(
        status === 401 && isUsingEnvToken()
          ? 'Authentication failed (AZEROTH_TOKEN invalid or revoked)'
          : classification.message,
        {
          code: classification.code,
          status,
          retryable: classification.retryable,
          retryAfterMs,
          exitCode: classification.exitCode,
          details: {
            message: body?.['message'] ?? err.message,
            ...(requestId ? { requestId } : {}),
          },
        }
      );
    }
    if (err instanceof CliError) throw err;
    throw new CliError(err instanceof Error ? err.message : String(err), {
      code: 'NETWORK_ERROR',
      retryable: true,
      exitCode: CLI_EXIT_CODES.TEMPORARY,
    });
  }
}
