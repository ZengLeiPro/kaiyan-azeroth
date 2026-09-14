import { describe, expect, it } from 'vitest';

import { BoundedChildOutput, sanitizeChildOutput } from '../bounded-child-output';

describe('BoundedChildOutput', () => {
  it('按字节累计并在越界前 fail-closed', () => {
    const output = new BoundedChildOutput(5);
    expect(output.append('abc')).toBe(true);
    expect(output.append('de')).toBe(true);
    expect(output.append('f')).toBe(false);
    expect(output.text()).toBe('abcde');
  });

  it('错误摘要去控制字符、换行并脱敏', () => {
    expect(sanitizeChildOutput('token=abc123\nBearer secret.value\u001b[31m', 200)).toBe(
      'token=[REDACTED] Bearer [REDACTED]'
    );
  });
});
