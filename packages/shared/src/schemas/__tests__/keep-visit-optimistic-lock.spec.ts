import { describe, expect, it } from 'vitest';

import { updateKeepRecordSchema } from '../keep-record';
import { updateVisitRecordSchema } from '../visit-record';

describe.each([
  ['跟进记录', updateKeepRecordSchema],
  ['拜访记录', updateVisitRecordSchema],
] as const)('%s update version contract', (_label, schema) => {
  it.each([undefined, 0, -1, 1.5])('拒绝缺失或非正整数 version=%s', (version) => {
    const input = version === undefined ? {} : { version };
    expect(schema.safeParse(input).success).toBe(false);
  });

  it('接受正整数 version', () => {
    expect(schema.safeParse({ version: 1 }).success).toBe(true);
  });
});
