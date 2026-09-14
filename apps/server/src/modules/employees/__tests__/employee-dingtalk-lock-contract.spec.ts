import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const employeesSource = readFileSync(resolve(__dirname, '../employees.service.ts'), 'utf8');
const authSource = readFileSync(resolve(__dirname, '../../auth/auth.service.ts'), 'utf8');

describe('Employee DingTalk bind-vs-bind/SSO static lock contract', () => {
  it('keeps the exact same typed identity lock namespace in bind/unbind and SSO', () => {
    expect(employeesSource).toContain('employee_dingtalk:user:${binding.dingtalkUserId}');
    expect(employeesSource).toContain('employee_dingtalk:union:${binding.dingtalkUnionId}');
    expect(authSource).toContain('employee_dingtalk:user:${identity.userId}');
    expect(authSource).toContain('employee_dingtalk:union:${identity.unionId}');
  });

  it('keeps fixed sorting, transaction-scoped advisory locks, and target employee serialization', () => {
    expect(employeesSource).toContain('employee_dingtalk:employee:${employeeId}');
    expect(employeesSource).toMatch(/for \(const lockKey of \[\.\.\.lockKeys\]\.sort\(\)\)/);
    expect(authSource).toMatch(/\][.]sort\(\)/);
    expect(employeesSource).toContain('pg_advisory_xact_lock');
    expect(authSource).toContain('pg_advisory_xact_lock');
  });

  it('holds the SSO pair lock through exact lookups and credential issuance', () => {
    const lockAt = authSource.indexOf('await this.lockDingtalkLoginIdentityPair');
    const userLookupAt = authSource.indexOf('dingtalkUserId: dingtalkUser.userId', lockAt);
    const unionLookupAt = authSource.indexOf('dingtalkUnionId: dingtalkUser.unionId', lockAt);
    const issueAt = authSource.indexOf('await this.issueLoginResult', lockAt);

    expect(lockAt).toBeGreaterThan(-1);
    expect(userLookupAt).toBeGreaterThan(lockAt);
    expect(unionLookupAt).toBeGreaterThan(lockAt);
    expect(issueAt).toBeGreaterThan(unionLookupAt);
  });
});
