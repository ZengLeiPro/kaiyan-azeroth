import { describe, expect, it } from 'vitest';

import { cleanParams, conditionalParams, mergeParams } from '../api-helpers';

describe('api-helpers', () => {
  describe('cleanParams', () => {
    it('should remove empty strings, null, and undefined', () => {
      const input = { name: 'foo', age: 0, city: '', status: null, country: undefined };
      const output = cleanParams(input);
      expect(output).toEqual({ name: 'foo', age: 0 });
    });

    it('should preserve 0 and false', () => {
      const input = { count: 0, active: false, name: '' };
      const output = cleanParams(input);
      expect(output).toEqual({ count: 0, active: false });
    });

    it('should handle all empty values', () => {
      const input = { a: '', b: null, c: undefined, d: 0 };
      const output = cleanParams(input);
      expect(output).toEqual({ d: 0 });
    });

    it('should preserve all truthy values (除空数组外)', () => {
      const input = { a: 'hello', b: 123, c: true, e: {} };
      const output = cleanParams(input);
      expect(output).toEqual(input);
    });

    it('should filter out empty arrays (多选筛选空值语义)', () => {
      const input = { status: [], keyword: 'hello', tags: ['a', 'b'] };
      const output = cleanParams(input);
      expect(output).toEqual({ keyword: 'hello', tags: ['a', 'b'] });
    });
  });

  describe('conditionalParams', () => {
    it('should only keep truthy values', () => {
      const input = { name: 'foo', age: 0, city: '', active: true };
      const output = conditionalParams(input);
      expect(output).toEqual({ name: 'foo', active: true });
    });

    it('should filter out 0 and false', () => {
      const input = { count: 0, active: false, name: 'test' };
      const output = conditionalParams(input);
      expect(output).toEqual({ name: 'test' });
    });

    it('should handle empty object', () => {
      const input = {};
      const output = conditionalParams(input);
      expect(output).toEqual({});
    });
  });

  describe('mergeParams', () => {
    it('should merge required and optional params', () => {
      const required = { page: 1, pageSize: 10 };
      const optional = { keyword: '', status: 'active', type: null };
      const output = mergeParams(required, optional);
      expect(output).toEqual({ page: 1, pageSize: 10, status: 'active' });
    });

    it('should preserve 0 in required params', () => {
      const required = { page: 1, count: 0 };
      const optional = { keyword: '' };
      const output = mergeParams(required, optional);
      expect(output).toEqual({ page: 1, count: 0 });
    });

    it('should handle empty optional params', () => {
      const required = { page: 1 };
      const optional = {};
      const output = mergeParams(required, optional);
      expect(output).toEqual({ page: 1 });
    });
  });
});
