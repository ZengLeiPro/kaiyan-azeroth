import { describe, expect, it } from 'vitest';

import { updateOpportunitySchema } from '../opportunity';

describe('商机 update version 乐观锁契约', () => {
  it.each([undefined, 0, -1, 1.5])('拒绝缺失或非正整数 version=%s', (version) => {
    const input = version === undefined ? {} : { version };
    expect(updateOpportunitySchema.safeParse(input).success).toBe(false);
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, '1', null])('拒绝非法 version=%s', (version) => {
    expect(updateOpportunitySchema.safeParse({ version }).success).toBe(false);
  });

  it('接受正整数 version', () => {
    expect(updateOpportunitySchema.safeParse({ version: 1 }).success).toBe(true);
    expect(updateOpportunitySchema.safeParse({ version: 8 }).success).toBe(true);
  });
});
