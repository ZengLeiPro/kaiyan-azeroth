import { describe, expect, it } from 'vitest';

import {
  fromJsonAttachments,
  fromJsonValue,
  toJsonAttachments,
  toJsonValue,
} from '../utils/json-type-helpers';

describe('toJsonAttachments', () => {
  it('应该将附件数组转换为 Prisma JSON 格式', () => {
    const attachments = [
      {
        name: 'file.pdf',
        url: 'https://example.com/file.pdf',
        size: 1024,
        mimeType: 'application/pdf',
      },
    ];
    const result = toJsonAttachments(attachments);
    expect(result).toBeDefined();
    const arr = result as Array<Record<string, unknown>>;
    expect(arr).toHaveLength(1);
    expect(arr[0]!.name).toBe('file.pdf');
    expect(arr[0]!.size).toBe(1024);
    expect(arr[0]!.mimeType).toBe('application/pdf');
  });

  it('应该为缺失字段填充默认值', () => {
    const attachments = [{ name: 'file.pdf', url: 'https://example.com/file.pdf' }];
    const result = toJsonAttachments(attachments) as Array<Record<string, unknown>>;
    expect(result[0]!.size).toBe(0);
    expect(result[0]!.mimeType).toBe('application/octet-stream');
  });

  it('应该使用 type 作为 mimeType 的后备', () => {
    const attachments = [
      { name: 'img.png', url: 'https://example.com/img.png', type: 'image/png' },
    ];
    const result = toJsonAttachments(attachments) as Array<Record<string, unknown>>;
    expect(result[0]!.mimeType).toBe('image/png');
  });

  it('应该保留已有的 id', () => {
    const attachments = [
      { id: 'existing-id', name: 'file.pdf', url: 'https://example.com/file.pdf' },
    ];
    const result = toJsonAttachments(attachments) as Array<Record<string, unknown>>;
    expect(result[0]!.id).toBe('existing-id');
  });

  it('应该对 null 返回 undefined', () => {
    expect(toJsonAttachments(null)).toBeUndefined();
  });

  it('应该对 undefined 返回 undefined', () => {
    expect(toJsonAttachments(undefined)).toBeUndefined();
  });

  it('应该对空数组返回 undefined', () => {
    expect(toJsonAttachments([])).toBeUndefined();
  });
});

describe('fromJsonAttachments', () => {
  it('应该正确解析附件 JSON', () => {
    const json = [
      {
        id: 'att-1',
        name: 'file.pdf',
        url: 'https://example.com/file.pdf',
        size: 1024,
        mimeType: 'application/pdf',
      },
    ];
    const result = fromJsonAttachments(json);
    expect(result).toHaveLength(1);
    expect(result[0]!.name).toBe('file.pdf');
    expect(result[0]!.size).toBe(1024);
  });

  it('应该为缺失字段填充默认值', () => {
    const json = [{}];
    const result = fromJsonAttachments(json);
    expect(result[0]!.name).toBe('unknown');
    expect(result[0]!.url).toBe('');
    expect(result[0]!.size).toBe(0);
  });

  it('应该对非数组返回空数组', () => {
    expect(fromJsonAttachments(null)).toEqual([]);
    expect(fromJsonAttachments('string')).toEqual([]);
    expect(fromJsonAttachments(123)).toEqual([]);
  });
});

describe('toJsonValue', () => {
  it('应该转换有效对象', () => {
    const obj = { key: 'value' };
    expect(toJsonValue(obj)).toEqual(obj);
  });

  it('应该对 null 返回 undefined', () => {
    expect(toJsonValue(null)).toBeUndefined();
  });

  it('应该对 undefined 返回 undefined', () => {
    expect(toJsonValue(undefined)).toBeUndefined();
  });
});

describe('fromJsonValue', () => {
  it('应该返回原始值', () => {
    const obj = { key: 'value' };
    expect(fromJsonValue<typeof obj>(obj)).toEqual(obj);
  });

  it('应该对 null 返回 undefined', () => {
    expect(fromJsonValue(null)).toBeUndefined();
  });

  it('应该对 undefined 返回 undefined', () => {
    expect(fromJsonValue(undefined)).toBeUndefined();
  });
});
