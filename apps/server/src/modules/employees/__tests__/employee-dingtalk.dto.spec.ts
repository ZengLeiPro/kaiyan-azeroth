import { describe, expect, it } from 'vitest';

import { BindEmployeeDingtalkDto, UnbindEmployeeDingtalkDto } from '../dto';

describe('employee DingTalk DTOs', () => {
  it('keeps bind as a strict old-pair CAS plus complete new pair DTO', () => {
    const valid = {
      version: 1,
      expectedDingtalkUserId: null,
      expectedDingtalkUnionId: null,
      dingtalkUserId: 'ding-user-1',
      dingtalkUnionId: 'ding-union-1',
    };

    expect(BindEmployeeDingtalkDto.schema.safeParse(valid).success).toBe(true);
    expect(
      BindEmployeeDingtalkDto.schema.safeParse({ ...valid, dingtalkUnionId: null }).success
    ).toBe(false);
    expect(BindEmployeeDingtalkDto.schema.safeParse({ ...valid, extra: true }).success).toBe(false);
  });

  it('keeps unbind as a strict old-pair CAS DTO', () => {
    const valid = {
      version: 1,
      expectedDingtalkUserId: 'ding-user-1',
      expectedDingtalkUnionId: 'ding-union-1',
    };
    expect(UnbindEmployeeDingtalkDto.schema.safeParse(valid).success).toBe(true);
    expect(UnbindEmployeeDingtalkDto.schema.safeParse({ version: 1 }).success).toBe(false);
    expect(
      UnbindEmployeeDingtalkDto.schema.safeParse({ ...valid, dingtalkUserId: null }).success
    ).toBe(false);
  });
});
