export class BoundedChildOutput {
  private readonly chunks: Buffer[] = [];
  private byteLength = 0;

  constructor(private readonly maxBytes: number) {
    if (!Number.isInteger(maxBytes) || maxBytes < 1) throw new Error('maxBytes must be positive');
  }

  append(chunk: Buffer | string): boolean {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    if (this.byteLength + buffer.length > this.maxBytes) return false;
    this.chunks.push(buffer);
    this.byteLength += buffer.length;
    return true;
  }

  text(): string {
    return Buffer.concat(this.chunks, this.byteLength).toString('utf8');
  }
}

function stripAnsiEscapeSequences(input: string): string {
  let output = '';
  for (let index = 0; index < input.length; index += 1) {
    if (input.charCodeAt(index) === 27 && input[index + 1] === '[') {
      index += 2;
      while (index < input.length) {
        const code = input.charCodeAt(index);
        if (code >= 64 && code <= 126) break;
        index += 1;
      }
      continue;
    }
    output += input[index];
  }
  return output;
}

export function sanitizeChildOutput(input: string, maxChars = 500): string {
  const withoutControlCharacters = Array.from(stripAnsiEscapeSequences(input))
    .filter((character) => {
      const code = character.charCodeAt(0);
      return !(
        (code >= 0 && code <= 8) ||
        code === 11 ||
        code === 12 ||
        (code >= 14 && code <= 31) ||
        code === 127
      );
    })
    .join('')
    .replace(/[\r\n]+/g, ' ');
  const redacted = withoutControlCharacters
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [REDACTED]')
    .replace(/\b(token|secret|password|api[-_]?key)\s*[:=]\s*[^\s,;]+/gi, '$1=[REDACTED]');
  return redacted.slice(0, maxChars);
}
