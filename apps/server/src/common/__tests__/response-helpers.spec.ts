import { Decimal } from '@prisma/client/runtime/library';
import { describe, expect, it } from 'vitest';

import {
  calculatePagination,
  serializeEntity,
  toDateOnlyString,
  toDecimalNumber,
} from '../utils/response-helpers';

describe('toDecimalNumber', () => {
  it('应该将 Decimal 转为 number', () => {
    const decimal = new Decimal('123.45');
    expect(toDecimalNumber(decimal)).toBe(123.45);
  });

  it('应该将 number 原样返回', () => {
    expect(toDecimalNumber(42)).toBe(42);
  });

  it('应该将 null 转为 0', () => {
    expect(toDecimalNumber(null)).toBe(0);
  });

  it('应该将 undefined 转为 0', () => {
    expect(toDecimalNumber(undefined)).toBe(0);
  });
});

describe('toDateOnlyString', () => {
  it('应该将 Date 对象转为 YYYY-MM-DD', () => {
    const date = new Date('2024-06-15T10:30:00Z');
    expect(toDateOnlyString(date)).toBe('2024-06-15');
  });

  it('应该将 ISO 字符串转为 YYYY-MM-DD', () => {
    expect(toDateOnlyString('2024-06-15T10:30:00Z')).toBe('2024-06-15');
  });

  it('应该对 null 返回 null', () => {
    expect(toDateOnlyString(null)).toBeNull();
  });

  it('应该对 undefined 返回 null', () => {
    expect(toDateOnlyString(undefined)).toBeNull();
  });
});

describe('calculatePagination', () => {
  it('应该正确计算第 1 页', () => {
    expect(calculatePagination(1, 20)).toEqual({ skip: 0, take: 20 });
  });

  it('应该正确计算第 3 页', () => {
    expect(calculatePagination(3, 10)).toEqual({ skip: 20, take: 10 });
  });
});

describe('serializeEntity', () => {
  it('应该将 Date 转为 ISO 字符串', () => {
    const date = new Date('2024-01-01T00:00:00.000Z');
    const result = serializeEntity<{ createdAt: string }>({ createdAt: date });
    expect(result.createdAt).toBe('2024-01-01T00:00:00.000Z');
  });

  it('应该将 Decimal 转为 number', () => {
    const result = serializeEntity<{ amount: number }>({
      amount: new Decimal('99.99'),
    });
    expect(result.amount).toBe(99.99);
  });

  it('应该递归处理嵌套对象', () => {
    const result = serializeEntity<{ nested: { date: string } }>({
      nested: { date: new Date('2024-01-01T00:00:00.000Z') },
    });
    expect(result.nested.date).toBe('2024-01-01T00:00:00.000Z');
  });

  it('应该递归处理数组', () => {
    const result = serializeEntity<{ items: Array<{ amount: number }> }>({
      items: [{ amount: new Decimal('1.1') }, { amount: new Decimal('2.2') }],
    });
    expect(result.items).toEqual([{ amount: 1.1 }, { amount: 2.2 }]);
  });

  it('应该保留原始值不变', () => {
    const result = serializeEntity<{ name: string; count: number; active: boolean }>({
      name: 'test',
      count: 42,
      active: true,
    });
    expect(result).toEqual({ name: 'test', count: 42, active: true });
  });

  it('应该处理 null 值', () => {
    const result = serializeEntity<{ value: null }>({ value: null });
    expect(result.value).toBeNull();
  });
});
