/**
 * 验证 shared 层 column-meta helper 的关键不变式：
 * - withColumn 不改变 Zod schema 的 _def.typeName（CLI 和 createZodDto 依赖这个）
 * - .optional() / .nullable() / .partial().extend() 后 meta 仍可读（克隆链稳健）
 * - stripColumnMetaMarker 剥离 JSON 前缀
 */
import {
  readColumnMeta,
  stripColumnMetaMarker,
  unwrapDeep,
  withColumn,
} from '@ky-azeroth/shared/schemas/column-meta';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

describe('withColumn / readColumnMeta', () => {
  it('基础字段：写入后可直接读回', () => {
    const field = withColumn(z.string(), { label: '客户名称', width: 200 });
    const meta = readColumnMeta(field);
    expect(meta).toEqual({ label: '客户名称', width: 200 });
  });

  it('保留 _def.typeName（CLI isZodObject 依赖）', () => {
    const raw = z.string();
    const wrapped = withColumn(raw, { label: 'x' });
    expect((wrapped as unknown as { _def: { typeName: string } })._def.typeName).toBe(
      (raw as unknown as { _def: { typeName: string } })._def.typeName
    );
  });

  it('z.string().optional() 仍可通过 unwrapDeep 读到 meta', () => {
    const field = withColumn(z.string(), { label: '备注', width: 160 }).optional();
    const meta = readColumnMeta(field);
    expect(meta?.label).toBe('备注');
  });

  it('z.string().optional().nullable() 嵌套链路也能读到', () => {
    const field = withColumn(z.string(), { label: '电话' }).optional().nullable();
    const meta = readColumnMeta(field);
    expect(meta?.label).toBe('电话');
  });

  it('在已有 .describe(人类描述) 之后附 meta，仍能读回 meta', () => {
    const field = withColumn(z.string().describe('人类可读的字段说明'), {
      label: '地址',
    });
    expect(readColumnMeta(field)?.label).toBe('地址');
    expect(stripColumnMetaMarker(field.description)).toBe('人类可读的字段说明');
  });

  it('幂等：在已有 meta 的 schema 再调 withColumn 可覆盖', () => {
    const field = withColumn(withColumn(z.string(), { label: 'A' }), { label: 'B' });
    expect(readColumnMeta(field)?.label).toBe('B');
  });

  it('顶层 object .partial().extend() 不影响字段级 meta', () => {
    const base = z.object({
      name: withColumn(z.string(), { label: '名称' }),
    });
    const extended = base.partial().extend({ version: z.number() });
    // 注意 .partial() 会把字段变 optional，但 innerType 仍是带 description 的原字段
    const field = extended.shape.name;
    const meta = readColumnMeta(field);
    expect(meta?.label).toBe('名称');
  });

  it('校验行为不受影响：.parse 结果与未附 meta 时一致', () => {
    const noMeta = z.string().min(2);
    const withMeta = withColumn(z.string().min(2), { label: 'x' });
    expect(() => withMeta.parse('ok')).not.toThrow();
    expect(() => withMeta.parse('')).toThrow();
    expect(withMeta.parse('abc')).toBe(noMeta.parse('abc'));
  });

  it('未挂 meta 的字段 readColumnMeta 返回 undefined', () => {
    expect(readColumnMeta(z.string())).toBeUndefined();
    expect(readColumnMeta(z.string().describe('仅人类可读'))).toBeUndefined();
  });

  it('unwrapDeep 穿透 ZodOptional/ZodNullable/ZodDefault', () => {
    const base = z.string();
    const wrapped = base.optional().nullable().default('x');
    expect(unwrapDeep(wrapped)).toBe(base);
  });

  it('stripColumnMetaMarker 在无 marker 时返回原值', () => {
    expect(stripColumnMetaMarker(undefined)).toBeUndefined();
    expect(stripColumnMetaMarker('纯描述')).toBe('纯描述');
  });
});
