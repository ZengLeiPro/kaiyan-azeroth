function containsControlCharacter(value: string): boolean {
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

/**
 * 仅允许站内绝对路径，拒绝协议相对 URL、反斜杠规范化和控制字符绕过。
 */
export function isSafeInternalPath(value: unknown): value is string {
  if (typeof value !== 'string' || !value.startsWith('/')) return false;
  if (containsControlCharacter(value)) return false;

  const [path = ''] = value.split(/[?#]/, 1);
  if (path.startsWith('//') || path.includes('\\')) return false;

  try {
    const decodedPath = decodeURIComponent(path);
    return !decodedPath.startsWith('//') && !decodedPath.includes('\\');
  } catch {
    return false;
  }
}

export function getSafeInternalPath(value: unknown, fallback = '/'): string {
  return isSafeInternalPath(value) ? value : fallback;
}
