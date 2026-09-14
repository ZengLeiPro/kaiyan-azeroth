/**
 * 验证 deriveExcelColumnsFromSchema 的关键行为：
 * - 单位换算 px → 字符
 * - 中文 label 最小宽度保护
 * - exportIgnore / 显式 exportWidth 覆盖
 * - exportFormatterKey 绑定格式化器
 */
import '../column-export-formatters';

import { withColumn } from '@ky-azeroth/shared/schemas/column-meta';
import { customerResponseSchema } from '@ky-azeroth/shared/schemas/customer';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { deriveExcelColumnsFromSchema } from '../excel-from-schema';

const schema = z.object({
  serialNumber: withColumn(z.string(), { label: '编号', width: 100 }),
  customerName: withColumn(z.string(), { label: '客户名称', exportWidth: 50 }),
  // 无 width、无 exportWidth → 回落 max(label*1.8, 15)
  remark: withColumn(z.string().optional(), {
    label: '备注很长的标签名',
    exportFormatterKey: 'text',
  }),
  amount: withColumn(z.number(), {
    label: '金额',
    width: 120,
    exportFormatterKey: 'decimal2',
  }),
  // 应被跳过
  internal: withColumn(z.string(), { label: '内部', exportIgnore: true }),
  // 无 meta 的字段也应被跳过
  id: z.string(),
});

describe('deriveExcelColumnsFromSchema', () => {
  it('只导出有 meta 且 exportIgnore 不为 true 的字段', () => {
    const cols = deriveExcelColumnsFromSchema(schema);
    const keys = cols.map((c) => c.key);
    expect(keys).toEqual(['serialNumber', 'customerName', 'remark', 'amount']);
    expect(keys).not.toContain('internal');
    expect(keys).not.toContain('id');
  });

  it('显式 exportWidth 直接使用', () => {
    const cols = deriveExcelColumnsFromSchema(schema);
    const customerName = cols.find((c) => c.key === 'customerName');
    expect(customerName?.width).toBe(50);
  });

  it('无 exportWidth 时 px→字符换算：width=100, label=2 字符 → max(round(100/7), ceil(2*1.8))=15', () => {
    const cols = deriveExcelColumnsFromSchema(schema);
    const serial = cols.find((c) => c.key === 'serialNumber');
    // round(100/7) = 14; label='编号'.length=2, ceil(2*1.8)=4 → max(14, 4)=14
    expect(serial?.width).toBe(14);
  });

  it('中文 label 保护：长 label 下限 = ceil(label.length * 1.8)', () => {
    const cols = deriveExcelColumnsFromSchema(schema);
    const remark = cols.find((c) => c.key === 'remark');
    // label='备注很长的标签名'.length=8, ceil(8*1.8)=15 → max(15, FALLBACK 15)=15
    expect(remark?.width).toBe(15);
  });

  it('exportFormatterKey 绑定格式化器：amount 用 decimal2', () => {
    const cols = deriveExcelColumnsFromSchema(schema);
    const amount = cols.find((c) => c.key === 'amount');
    expect(amount?.formatter).toBeDefined();
    expect(amount?.formatter?.(123.456, {})).toBe('123.46');
    expect(amount?.formatter?.(null, {})).toBe('');
  });

  it('客户意向与线索有效性导出中文标签', () => {
    const cols = deriveExcelColumnsFromSchema(customerResponseSchema);
    const intentTemperature = cols.find((c) => c.key === 'intentTemperature');
    const leadValidity = cols.find((c) => c.key === 'leadValidity');

    expect(intentTemperature?.formatter?.('HIGH', {})).toBe('高意向');
    expect(intentTemperature?.formatter?.('UNJUDGED', {})).toBe('未判断');
    expect(leadValidity?.formatter?.('VALID', {})).toBe('有效');
    expect(leadValidity?.formatter?.('INVALID', {})).toBe('无效');
  });

  it('pxPerChar 可覆盖', () => {
    const cols = deriveExcelColumnsFromSchema(schema, { pxPerChar: 10 });
    const serial = cols.find((c) => c.key === 'serialNumber');
    // round(100/10) = 10; label 下限 4 → max(10, 4)=10
    expect(serial?.width).toBe(10);
  });

  it('overrides 可替换 header/formatter', () => {
    const cols = deriveExcelColumnsFromSchema(schema, {
      overrides: [{ key: 'amount', header: '订单金额' }],
    });
    const amount = cols.find((c) => c.key === 'amount');
    expect(amount?.header).toBe('订单金额');
  });

  it('未指定 exportFormatterKey 时按 type 推断日期时间格式', () => {
    const datetimeSchema = z.object({
      createdAt: withColumn(z.string(), { label: '创建时间', type: 'datetime' }),
      businessDate: withColumn(z.string(), { label: '业务日期', type: 'date' }),
    });
    const cols = deriveExcelColumnsFromSchema(datetimeSchema);
    const createdAt = cols.find((c) => c.key === 'createdAt');
    const businessDate = cols.find((c) => c.key === 'businessDate');
    const local = new Date(2026, 5, 25, 9, 8);
    expect(createdAt?.formatter?.(local.toISOString(), {})).toBe('2026-06-25 09:08');
    expect(businessDate?.formatter?.('2026-06-25T09:08:00.000Z', {})).toBe('2026-06-25');
  });
});
