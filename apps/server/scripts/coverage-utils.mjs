import { existsSync, readFileSync } from 'node:fs';
import { relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
export const repoRoot = resolve(root, '../..');
export const metrics = ['statements', 'branches', 'functions', 'lines'];

export function readJson(path, description) {
  if (!existsSync(path)) {
    const hint = path.includes('/coverage/')
      ? '\n请先运行 pnpm test:cov 生成 coverage-summary.json。'
      : '';
    throw new Error(`${description} 不存在：${path}${hint}`);
  }

  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new Error(`${description} 不是合法 JSON：${path}\n${error instanceof Error ? error.message : String(error)}`);
  }
}

export function requireFiniteNumber(value, label) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${label} 必须是有限数字，实际值：${String(value)}`);
  }
  return value;
}

export function normalizeRepoPath(path) {
  const normalized = path.replace(/\\/g, '/').replace(/^\.\//, '');
  const normalizedRepoRoot = repoRoot.replace(/\\/g, '/');
  const normalizedServerRoot = root.replace(/\\/g, '/');

  if (normalized.startsWith(normalizedRepoRoot + '/')) {
    return relative(repoRoot, normalized).split(sep).join('/');
  }
  if (normalized.startsWith(normalizedServerRoot + '/')) {
    return `apps/server/${relative(root, normalized).split(sep).join('/')}`;
  }
  if (normalized.startsWith('src/')) {
    return `apps/server/${normalized}`;
  }
  return normalized;
}

export function findCoverageEntry(summary, repoRelativePath) {
  const normalizedTarget = normalizeRepoPath(repoRelativePath);
  for (const [entryPath, entry] of Object.entries(summary)) {
    if (entryPath === 'total') continue;
    if (normalizeRepoPath(entryPath) === normalizedTarget) return entry;
  }
  return undefined;
}

export function formatMetric(entry, metric) {
  const value = requireFiniteNumber(entry?.[metric]?.pct, `${metric}.pct`);
  return `${metric}=${value}%`;
}
