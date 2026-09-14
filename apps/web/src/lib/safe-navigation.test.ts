import { describe, expect, it } from 'vitest';

import { getSafeInternalPath, isSafeInternalPath } from './safe-navigation';

describe('safe-navigation', () => {
  it.each([
    '/',
    '/dashboard',
    '/crm/customers?highlight=123',
    '/login?redirect=%2Fdashboard',
    '/path#section',
  ])('接受站内绝对路径：%s', (value) => {
    expect(isSafeInternalPath(value)).toBe(true);
    expect(getSafeInternalPath(value)).toBe(value);
  });

  it.each([
    'https://evil.example',
    '//evil.example/path',
    '/\\evil.example/path',
    '/%5Cevil.example/path',
    '/%2f%2fevil.example/path',
    '/bad%ZZpath',
    '/path\nheader:value',
    '',
    null,
  ])('拒绝可离站或畸形路径：%s', (value) => {
    expect(isSafeInternalPath(value)).toBe(false);
    expect(getSafeInternalPath(value)).toBe('/');
  });
});
