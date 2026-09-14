import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const customersDir = path.resolve(__dirname, '..');
const modulesDir = path.dirname(customersDir);
const serverSrcDir = path.resolve(modulesDir, '..');

function source(relativePath: string): string {
  return fs.readFileSync(path.join(serverSrcDir, relativePath), 'utf8');
}

describe('CRM lifecycle dependency boundaries', () => {
  it('Customers → KeepRecords remains one-way without Nest forwardRef', () => {
    const customersModule = source('modules/customers/customers.module.ts');
    const customersService = source('modules/customers/customers.service.ts');
    const keepRecordsModule = source('modules/keep-records/keep-records.module.ts');
    const keepRecordsService = source('modules/keep-records/keep-records.service.ts');

    expect(customersModule).toContain("from '../keep-records/keep-records.module'");
    expect(customersModule).not.toContain('forwardRef');
    expect(customersService).toContain("from '../keep-records/keep-records.service'");
    expect(customersService).not.toContain('forwardRef');
    expect(keepRecordsModule).not.toMatch(/customers\/(?:customers\.module|customers\.service)/);
    expect(keepRecordsModule).not.toContain('forwardRef');
    expect(keepRecordsService).not.toMatch(/customers\/customers\.service/);
    expect(keepRecordsService).not.toContain('forwardRef');
    expect(keepRecordsService).toContain("from '../customers/customer-lifecycle.service'");
  });

  it('lifecycle orchestration is a leaf with no KeepRecords service dependency', () => {
    const lifecycleService = source('modules/customers/customer-lifecycle.service.ts');
    const lifecycleDomain = source('modules/customers/customer-lifecycle.ts');

    expect(lifecycleService).not.toMatch(/keep-records|customers\.service/);
    expect(lifecycleDomain).not.toMatch(/keep-records\.service|customers\.service/);
    expect(lifecycleDomain).not.toContain('skipRefresh');
  });

  it('filter registry helpers import leaf modules instead of their own barrel', () => {
    const helpers = source('common/filter-scheme/registry-helpers.ts');

    expect(helpers).not.toMatch(/from ['"]\.\/index['"]/);
    expect(helpers).toContain("from './define'");
    expect(helpers).toContain("from './escape-like'");
  });
});
