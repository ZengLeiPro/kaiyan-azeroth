import { describe, expect, it } from 'vitest';

import { customerResponseSchema, updateLeadProgressSchema } from '../customer';

describe('customerResponseSchema', () => {
  it.each([undefined, 0, -1, 1.5, Number.NaN])('response version 拒绝 %s', (version) => {
    expect(customerResponseSchema.shape.version.safeParse(version).success).toBe(false);
  });

  it('response version 接受正整数', () => {
    expect(customerResponseSchema.shape.version.parse(3)).toBe(3);
  });
});

describe('updateLeadProgressSchema', () => {
  it('预约拜访必须携带带时区的时间', () => {
    expect(
      updateLeadProgressSchema.safeParse({ status: 'PENDING_VISIT', version: 1 }).success
    ).toBe(false);
    expect(
      updateLeadProgressSchema.safeParse({
        status: 'PENDING_VISIT',
        appointmentAt: '2026-07-21T02:00:00.000Z',
        version: 1,
      }).success
    ).toBe(true);
  });

  it.each(['NO_SHOW', 'LOST'] as const)('%s 必须填写原因', (status) => {
    expect(updateLeadProgressSchema.safeParse({ status, version: 1 }).success).toBe(false);
    expect(
      updateLeadProgressSchema.safeParse({ status, reason: '客户明确取消', version: 1 }).success
    ).toBe(true);
  });

  it('拒绝人工伪造已拜访或已成交', () => {
    expect(updateLeadProgressSchema.safeParse({ status: 'VISITED', version: 1 }).success).toBe(
      false
    );
    expect(updateLeadProgressSchema.safeParse({ status: 'WON', version: 1 }).success).toBe(false);
  });
});
