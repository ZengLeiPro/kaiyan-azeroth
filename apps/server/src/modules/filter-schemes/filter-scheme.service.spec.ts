import { UnprocessableEntityException } from '@nestjs/common';
import { vi } from 'vitest';

import { defineFilterRegistry } from '../../common/filter-scheme';
import { FilterSchemeRegistry } from '../../common/filter-scheme/registry.service';
import {
  asPrismaService,
  createMockPrismaService,
  type MockPrismaService,
} from '../../test/prisma-mock.factory';
import { FilterSchemesService } from './filter-schemes.service';

const TEST_REGISTRY = defineFilterRegistry({
  pageKey: 'crm.customers',
  pageName: '客户列表',
  fields: {
    customerLevel: {
      label: '客户等级',
      dataType: 'enum',
      allowedControls: ['select', 'multiSelect'],
      build: (value) =>
        Array.isArray(value) && value.length > 0 ? { customerLevel: { in: value } } : null,
    },
    customerName: {
      label: '客户名称',
      dataType: 'string',
      searchable: true,
      allowedControls: ['text'],
      build: (value) =>
        typeof value === 'string'
          ? {
              customerName: {
                contains: value,
                mode: 'insensitive',
              },
            }
          : null,
    },
    hiddenField: {
      label: '隐藏字段',
      dataType: 'string',
      searchable: false,
      allowedControls: ['text'],
      build: (value) =>
        typeof value === 'string'
          ? {
              hiddenField: {
                contains: value,
                mode: 'insensitive',
              },
            }
          : null,
    },
  },
  defaults: {
    fields: [{ fieldKey: 'customerLevel', control: 'multiSelect' }],
    keyword: {
      enabled: true,
      fieldKeys: ['customerName'],
      placeholder: '客户名称',
    },
  },
});

describe('FilterSchemesService', () => {
  let service: FilterSchemesService;
  let registryStore: FilterSchemeRegistry;
  let mockPrisma: MockPrismaService;

  beforeEach(() => {
    registryStore = new FilterSchemeRegistry();
    mockPrisma = createMockPrismaService();
    service = new FilterSchemesService(asPrismaService(mockPrisma), registryStore);
    registryStore.register(TEST_REGISTRY);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('validateConfig', () => {
    it('应拒绝未声明 fieldKey', () => {
      expect(() =>
        service.validateConfig(TEST_REGISTRY, {
          fields: [{ fieldKey: 'ghost', control: 'text' }],
          keyword: { enabled: false, fieldKeys: [], placeholder: null },
        })
      ).toThrow(UnprocessableEntityException);
    });

    it('应拒绝重复 fieldKey', () => {
      expect(() =>
        service.validateConfig(TEST_REGISTRY, {
          fields: [
            { fieldKey: 'customerLevel', control: 'multiSelect' },
            { fieldKey: 'customerLevel', control: 'select' },
          ],
          keyword: { enabled: false, fieldKeys: [], placeholder: null },
        })
      ).toThrow(UnprocessableEntityException);
    });

    it('应拒绝非法控件组合', () => {
      expect(() =>
        service.validateConfig(TEST_REGISTRY, {
          fields: [{ fieldKey: 'customerLevel', control: 'dateRange' }],
          keyword: { enabled: false, fieldKeys: [], placeholder: null },
        })
      ).toThrow(UnprocessableEntityException);
    });

    it('应拒绝非 searchable string 的 keyword 字段', () => {
      expect(() =>
        service.validateConfig(TEST_REGISTRY, {
          fields: [{ fieldKey: 'customerLevel', control: 'multiSelect' }],
          keyword: { enabled: true, fieldKeys: ['hiddenField'], placeholder: null },
        })
      ).toThrow(UnprocessableEntityException);
    });

    it('应拒绝开启 keyword 但 fieldKeys 为空', () => {
      expect(() =>
        service.validateConfig(TEST_REGISTRY, {
          fields: [{ fieldKey: 'customerLevel', control: 'multiSelect' }],
          keyword: { enabled: true, fieldKeys: [], placeholder: null },
        })
      ).toThrow(UnprocessableEntityException);
    });

    it('应拒绝重复 keyword 字段', () => {
      expect(() =>
        service.validateConfig(TEST_REGISTRY, {
          fields: [{ fieldKey: 'customerLevel', control: 'multiSelect' }],
          keyword: {
            enabled: true,
            fieldKeys: ['customerName', 'customerName'],
            placeholder: null,
          },
        })
      ).toThrow(UnprocessableEntityException);
    });
  });

  describe('onModuleInit', () => {
    it('应在启动时 pruning 悬挂 fieldKey、非法 control 和非法 keyword 字段', async () => {
      mockPrisma.filterScheme.findUnique.mockResolvedValue({
        id: 'scheme-1',
        configJson: {
          fields: [
            { fieldKey: 'customerLevel', control: 'dateRange' },
            { fieldKey: 'ghostField', control: 'text' },
            { fieldKey: 'customerLevel', control: 'multiSelect' },
          ],
          keyword: {
            enabled: true,
            fieldKeys: ['customerName', 'ghostField', 'hiddenField'],
            placeholder: '客户',
          },
        },
      });
      mockPrisma.filterScheme.update.mockResolvedValue({
        id: 'scheme-1',
      });

      await service.onModuleInit();

      expect(mockPrisma.filterScheme.update).toHaveBeenCalledWith({
        where: { id: 'scheme-1' },
        data: {
          configJson: expect.objectContaining({
            fields: [{ fieldKey: 'customerLevel', control: 'select' }],
            keyword: {
              enabled: true,
              fieldKeys: ['customerName'],
              placeholder: '客户',
            },
          }),
          // push 6: schema 已无 updatedBy 字段
          version: { increment: 1 },
        },
      });
    });

    it('结构非法时应回退到 defaults', async () => {
      mockPrisma.filterScheme.findUnique.mockResolvedValue({
        id: 'scheme-2',
        configJson: {
          fields: 'bad-payload',
          keyword: null,
        },
      });
      mockPrisma.filterScheme.update.mockResolvedValue({
        id: 'scheme-2',
      });

      await service.onModuleInit();

      expect(mockPrisma.filterScheme.update).toHaveBeenCalledWith({
        where: { id: 'scheme-2' },
        data: {
          configJson: expect.objectContaining({
            fields: [{ fieldKey: 'customerLevel', control: 'multiSelect' }],
            keyword: {
              enabled: true,
              fieldKeys: ['customerName'],
              placeholder: '客户名称',
            },
          }),
          // push 6: schema 已无 updatedBy 字段
          version: { increment: 1 },
        },
      });
    });
  });
});
