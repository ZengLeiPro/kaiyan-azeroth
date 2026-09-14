/**
 * 验证 deriveColumnsFromSchema 的关键行为：
 * - 无 meta 的字段不进表格（但 include 白名单也不强拉）
 * - overrides 四种 mode（默认 override / replace / before / after）合并正确
 * - order 元数据影响列顺序
 * - 内置渲染器绑定（type=text 时 render 返回值与注册表一致）
 */
// 触发内置渲染器注册（side-effect）
import '../column-renderers';

import { withColumn } from '@ky-azeroth/shared/schemas/column-meta';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { deriveColumnsFromSchema, deriveColumnVisibilityConfig } from '../columns-from-schema';

const sampleSchema = z.object({
  id: z.string(),
  serialNumber: withColumn(z.string(), { label: '编号', width: 100, type: 'text', required: true }),
  name: withColumn(z.string(), { label: '名称', minWidth: 200, sortable: true }),
  hiddenField: withColumn(z.string().optional(), { label: '隐藏', hidden: true }),
  createdAt: withColumn(z.string(), { label: '创建时间', width: 160, type: 'datetime', order: 99 }),
  // 无 meta 的字段：不应出现在列里
  internalToken: z.string(),
});

describe('deriveColumnsFromSchema', () => {
  it('按 schema 顺序派生出有 meta 的列，跳过无 meta 字段', () => {
    const cols = deriveColumnsFromSchema(sampleSchema);
    const keys = cols.map((c) => c.key);
    expect(keys).toEqual(['serialNumber', 'name', 'hiddenField', 'createdAt']);
    expect(keys).not.toContain('id');
    expect(keys).not.toContain('internalToken');
  });

  it('ColumnMeta 字段正确映射到 DataTableColumn', () => {
    const cols = deriveColumnsFromSchema(sampleSchema);
    const serial = cols.find((c) => c.key === 'serialNumber');
    expect(serial?.header).toBe('编号');
    expect(serial?.width).toBe(100);
    const name = cols.find((c) => c.key === 'name');
    expect(name?.minWidth).toBe(200);
    expect(name?.sortable).toBe(true);
  });

  it('overrides 默认 override 模式：合并单字段、保留 schema 其它属性', () => {
    const cols = deriveColumnsFromSchema(sampleSchema, {
      overrides: [{ key: 'name', render: () => 'CUSTOM' }],
    });
    const name = cols.find((c) => c.key === 'name');
    expect(name?.minWidth).toBe(200); // schema 来的保留
    expect(name?.render).toBeDefined();
  });

  it('overrides replace 模式：完全替换该 key', () => {
    const cols = deriveColumnsFromSchema(sampleSchema, {
      overrides: [{ key: 'name', mode: 'replace', header: '新名称', width: 999 }],
    });
    const name = cols.find((c) => c.key === 'name');
    expect(name?.header).toBe('新名称');
    expect(name?.width).toBe(999);
    expect(name?.minWidth).toBeUndefined(); // 不再继承 schema
  });

  it('overrides after 模式：追加虚拟列', () => {
    const cols = deriveColumnsFromSchema(sampleSchema, {
      overrides: [{ key: '_actions', mode: 'after', header: '操作', width: 64 }],
    });
    expect(cols[cols.length - 1]?.key).toBe('_actions');
  });

  it('overrides before 模式：前置虚拟列', () => {
    const cols = deriveColumnsFromSchema(sampleSchema, {
      overrides: [{ key: '_selection', mode: 'before', header: '', width: 40 }],
    });
    expect(cols[0]?.key).toBe('_selection');
  });

  it('include 白名单限制 + 顺序控制', () => {
    const cols = deriveColumnsFromSchema(sampleSchema, {
      include: ['name', 'serialNumber'],
    });
    expect(cols.map((c) => c.key)).toEqual(['name', 'serialNumber']);
  });

  it('exclude 黑名单', () => {
    const cols = deriveColumnsFromSchema(sampleSchema, { exclude: ['hiddenField'] });
    expect(cols.map((c) => c.key)).not.toContain('hiddenField');
  });

  it('order 元数据调整顺序（createdAt order=99 应排到末尾）', () => {
    const cols = deriveColumnsFromSchema(sampleSchema);
    expect(cols[cols.length - 1]?.key).toBe('createdAt');
  });

  it('内置渲染器 type=text 绑定成功', () => {
    const cols = deriveColumnsFromSchema(sampleSchema);
    const serial = cols.find((c) => c.key === 'serialNumber');
    expect(serial?.render).toBeDefined();
    const rendered = serial?.render?.({ serialNumber: 'ABC-001' } as never, 0);
    // text 渲染器对非空值返回字符串 'ABC-001'
    expect(rendered).toBe('ABC-001');
  });

  it('内置渲染器 type=datetime 格式为 YYYY-MM-DD HH:mm', () => {
    const cols = deriveColumnsFromSchema(sampleSchema);
    const createdAt = cols.find((c) => c.key === 'createdAt');
    expect(createdAt?.render).toBeDefined();
    const local = new Date(2026, 5, 25, 9, 8);
    const rendered = createdAt?.render?.({ createdAt: local.toISOString() } as never, 0) as {
      props?: { children?: unknown };
    };
    expect(rendered?.props?.children).toBe('2026-06-25 09:08');
  });
});

describe('deriveColumnVisibilityConfig', () => {
  it('从同一 schema 派生 visibility 配置', () => {
    const config = deriveColumnVisibilityConfig(sampleSchema);
    const keys = config.map((c) => c.key);
    expect(keys).toEqual(['serialNumber', 'name', 'hiddenField', 'createdAt']);
  });

  it('hidden=true → visible=false', () => {
    const config = deriveColumnVisibilityConfig(sampleSchema);
    const hidden = config.find((c) => c.key === 'hiddenField');
    expect(hidden?.visible).toBe(false);
    const shown = config.find((c) => c.key === 'name');
    expect(shown?.visible).toBe(true);
  });

  it('required=true → canHide=false', () => {
    const config = deriveColumnVisibilityConfig(sampleSchema);
    const serial = config.find((c) => c.key === 'serialNumber');
    expect(serial?.canHide).toBe(false);
  });
});
