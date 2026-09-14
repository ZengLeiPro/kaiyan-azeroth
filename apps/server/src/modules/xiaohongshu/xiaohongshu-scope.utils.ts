export function parseXiaohongshuScopes(scope: string | undefined): string[] | undefined {
  const normalized = scope?.trim();
  if (!normalized) return undefined;

  try {
    const parsed: unknown = JSON.parse(normalized);
    if (Array.isArray(parsed)) {
      return parsed
        .filter((item): item is string => typeof item === 'string')
        .map((item) => item.trim())
        .filter(Boolean);
    }
  } catch {
    // 兼容逗号或空格分隔的历史返回格式。
  }

  return normalized.split(/[,\s]+/).filter(Boolean);
}
