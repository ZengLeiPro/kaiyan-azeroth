import { describe, expect, it, vi } from 'vitest';

import { PersonalFilterSchemesService } from './personal-filter-schemes.service';

const registry = { pageKey: 'crm.customers', fields: {}, defaults: {} };

describe('PersonalFilterSchemesService', () => {
  it('读取个人展示配置时必须同时按员工与页面隔离', async () => {
    const findUnique = vi.fn().mockResolvedValue(null);
    const service = createService({ personalFilterPreference: { findUnique } });

    await expect(service.getPreference('crm.customers', 'employee-a')).resolves.toBeNull();
    expect(findUnique).toHaveBeenCalledWith({
      where: { employeeId_pageKey: { employeeId: 'employee-a', pageKey: 'crm.customers' } },
    });
  });

  it('列出个人方案时不能读取其他员工同页面方案', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const service = createService({ personalFilterPreset: { findMany } });

    await expect(service.listPresets('crm.customers', 'employee-a')).resolves.toEqual({
      items: [],
      total: 0,
    });
    expect(findMany).toHaveBeenCalledWith({
      where: { employeeId: 'employee-a', pageKey: 'crm.customers' },
      orderBy: { updatedAt: 'desc' },
    });
  });

  it('更新方案前按当前员工查找，避免猜测 id 越权', async () => {
    const findFirst = vi.fn().mockResolvedValue({ id: 'preset-a' });
    const update = vi.fn().mockResolvedValue({
      id: 'preset-a',
      pageKey: 'crm.customers',
      name: '本周客户',
      filtersJson: {},
      version: 2,
      createdAt: new Date('2026-09-02T00:00:00.000Z'),
      updatedAt: new Date('2026-09-02T00:00:00.000Z'),
    });
    const service = createService({ personalFilterPreset: { findFirst, update } });

    await service.updatePreset('preset-a', { name: '本周客户', version: 1 }, 'employee-a');
    expect(findFirst).toHaveBeenCalledWith({ where: { id: 'preset-a', employeeId: 'employee-a' } });
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'preset-a', version: 1 } })
    );
  });
});

function createService(prismaOverrides: Record<string, unknown>): PersonalFilterSchemesService {
  const prisma = {
    personalFilterPreference: {},
    personalFilterPreset: {},
    ...prismaOverrides,
  };
  const registryStore = { get: vi.fn().mockReturnValue(registry) };
  const filterSchemesService = { validateConfig: vi.fn((_: unknown, config: unknown) => config) };
  return new PersonalFilterSchemesService(
    prisma as never,
    registryStore as never,
    filterSchemesService as never
  );
}
