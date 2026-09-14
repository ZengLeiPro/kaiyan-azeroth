import { Injectable, Logger } from '@nestjs/common';

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

const DEFAULT_TTL_MS = 5 * 60 * 1000;
const MAX_ENTRIES = 1000;

const ME_CACHE_KEY_PREFIX = 'me:';
const JWT_CACHE_KEY_PREFIX = 'jwt:';
const SCOPE_CACHE_PREFIX = 'scope:';

/**
 * 一个 employee 在 auth 链路上的全部缓存 key(getMe 的 + jwt.strategy 的)。
 * 任何修改 employee/userRole/role 的写路径都应通过 `cache.invalidateMany(authCacheKeysFor(id))`
 * 一次清空,避免在多个文件里硬编码字面量 prefix 导致未来漏改。
 */
export function authCacheKeysFor(employeeId: string): [string, string] {
  return [`${ME_CACHE_KEY_PREFIX}${employeeId}`, `${JWT_CACHE_KEY_PREFIX}${employeeId}`];
}

export function meCacheKey(employeeId: string): string {
  return `${ME_CACHE_KEY_PREFIX}${employeeId}`;
}

export function jwtCacheKey(employeeId: string): string {
  return `${JWT_CACHE_KEY_PREFIX}${employeeId}`;
}

/**
 * 给定 employeeId,返回 scope 缓存的前缀(用于 `invalidateByPrefix` 失效)。
 * scope 缓存按 (employeeId, module, menu) 三段拼 key,所以需要按前缀清。
 * 使用方:`cache.invalidateByPrefix(scopeCacheKeyPrefixFor(employeeId))`
 */
export function scopeCacheKeyPrefixFor(employeeId: string): string {
  return `${SCOPE_CACHE_PREFIX}${employeeId}:`;
}

/**
 * 进程内 LRU 缓存,用于 auth/jwt 校验路径上 employee→userRoles→role→permissions
 * 三层 include 的高频查询结果。
 *
 * 失效语义:任何修改 employee/userRole/role/permission 的写路径必须主动
 * invalidate 受影响的 employeeId;TTL 5min 兜底自然失效。
 *
 * 单实例本地缓存 — FC 多实例下不共享,可接受(权限变更后单实例最多 5min 才统一)。
 */
@Injectable()
export class EmployeePermissionCacheService {
  private readonly logger = new Logger(EmployeePermissionCacheService.name);
  private readonly store = new Map<string, CacheEntry<unknown>>();

  get<T>(key: string): T | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= Date.now()) {
      this.store.delete(key);
      return undefined;
    }
    return entry.value as T;
  }

  set<T>(key: string, value: T, ttlMs: number = DEFAULT_TTL_MS): void {
    if (this.store.size >= MAX_ENTRIES && !this.store.has(key)) {
      this.evictOldest();
    }
    this.store.set(key, { value, expiresAt: Date.now() + ttlMs });
  }

  invalidate(key: string): void {
    this.store.delete(key);
  }

  invalidateMany(keys: Iterable<string>): void {
    for (const key of keys) {
      this.store.delete(key);
    }
  }

  /**
   * 按前缀失效(线性扫描)。
   * scope 缓存按 (employeeId, module, menu) 三段拼 key,需要按前缀清。
   * 命中率高时调用频次低,O(n) 可接受。
   */
  invalidateByPrefix(prefix: string): void {
    for (const key of this.store.keys()) {
      if (key.startsWith(prefix)) {
        this.store.delete(key);
      }
    }
  }

  invalidateAll(): void {
    this.store.clear();
  }

  size(): number {
    return this.store.size;
  }

  private evictOldest(): void {
    let oldestKey: string | undefined;
    let oldestExpiry = Number.POSITIVE_INFINITY;
    for (const [key, entry] of this.store) {
      if (entry.expiresAt < oldestExpiry) {
        oldestExpiry = entry.expiresAt;
        oldestKey = key;
      }
    }
    if (oldestKey) {
      this.store.delete(oldestKey);
    }
  }
}
