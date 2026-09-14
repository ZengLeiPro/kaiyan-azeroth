import { describe, expect, it } from 'vitest';

import { isAutomaticRetryMethod } from '../api';

describe('isAutomaticRetryMethod', () => {
  it.each(['get', 'GET', 'head', 'HEAD', 'options'])('允许安全方法 %s 自动重试', (method) => {
    expect(isAutomaticRetryMethod(method)).toBe(true);
  });

  it.each(['post', 'POST', 'put', 'patch', 'delete', undefined])(
    '禁止写方法 %s 自动重试',
    (method) => {
      expect(isAutomaticRetryMethod(method)).toBe(false);
    }
  );
});
