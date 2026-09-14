import { describe, expect, it } from 'vitest';

import {
  bindEmployeeDingtalkSchema,
  unbindEmployeeDingtalkSchema,
  updateEmployeeSchema,
} from '../employee';

describe('employee ordinary update contract', () => {
  it.each(['dingtalkUserId', 'dingtalkUnionId', 'dingtalkActive'])(
    'rejects identity field %s from the ordinary update schema',
    (field) => {
      expect(updateEmployeeSchema.safeParse({ version: 1, [field]: 'ding-id' }).success).toBe(
        false
      );
    }
  );

  it('still accepts ordinary employee profile fields', () => {
    expect(updateEmployeeSchema.safeParse({ version: 1, name: '张三' }).success).toBe(true);
  });
});

describe('employee DingTalk binding contract', () => {
  const validBinding = {
    version: 1,
    expectedDingtalkUserId: null,
    expectedDingtalkUnionId: null,
    dingtalkUserId: 'ding-user-1',
    dingtalkUnionId: 'ding-union-1',
  };

  it('requires version, the complete expected old pair, and a complete non-null new pair', () => {
    expect(bindEmployeeDingtalkSchema.safeParse(validBinding).success).toBe(true);
    for (const field of Object.keys(validBinding)) {
      const body = { ...validBinding } as Record<string, unknown>;
      delete body[field];
      expect(bindEmployeeDingtalkSchema.safeParse(body).success).toBe(false);
    }
    expect(
      bindEmployeeDingtalkSchema.safeParse({ ...validBinding, dingtalkUnionId: null }).success
    ).toBe(false);
  });

  it.each([
    { ...validBinding, version: 0 },
    { ...validBinding, version: 1.5 },
    { ...validBinding, version: '1' },
    { ...validBinding, dingtalkUserId: '' },
    { ...validBinding, dingtalkUnionId: '   ' },
    { ...validBinding, expectedDingtalkUserId: '' },
    { ...validBinding, unexpected: true },
  ])('rejects an invalid bind body %#', (body) => {
    expect(bindEmployeeDingtalkSchema.safeParse(body).success).toBe(false);
  });

  it('trims all non-null identity values', () => {
    expect(
      bindEmployeeDingtalkSchema.parse({
        version: 2,
        expectedDingtalkUserId: ' old-user ',
        expectedDingtalkUnionId: ' old-union ',
        dingtalkUserId: ' user-2 ',
        dingtalkUnionId: ' union-2 ',
      })
    ).toEqual({
      version: 2,
      expectedDingtalkUserId: 'old-user',
      expectedDingtalkUnionId: 'old-union',
      dingtalkUserId: 'user-2',
      dingtalkUnionId: 'union-2',
    });
  });
});

describe('employee DingTalk unbinding contract', () => {
  const validUnbind = {
    version: 1,
    expectedDingtalkUserId: 'ding-user-1',
    expectedDingtalkUnionId: 'ding-union-1',
  };

  it('requires a positive version and the explicit nullable old pair only', () => {
    expect(unbindEmployeeDingtalkSchema.safeParse(validUnbind).success).toBe(true);
    expect(
      unbindEmployeeDingtalkSchema.safeParse({
        version: 1,
        expectedDingtalkUserId: null,
        expectedDingtalkUnionId: null,
      }).success
    ).toBe(true);
    expect(unbindEmployeeDingtalkSchema.safeParse({ version: 1 }).success).toBe(false);
    expect(
      unbindEmployeeDingtalkSchema.safeParse({ ...validUnbind, dingtalkUserId: null }).success
    ).toBe(false);
  });
});
