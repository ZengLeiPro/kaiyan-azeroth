import { ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { vi } from 'vitest';

import {
  asPrismaService,
  createMockPrismaService,
  type MockPrismaService,
} from '../../../test/prisma-mock.factory';
import { SystemParamsService } from '../system-params.service';

function buildConfig(overrides = {}) {
  return {
    id: 'cfg-1',
    code: 'SYSTEM_NAME',
    group: 'general',
    name: '系统名称',
    value: '示例',
    type: 'string',
    description: '描述',
    version: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe('SystemParamsService', () => {
  let service: SystemParamsService;
  let mockPrisma: MockPrismaService;

  beforeEach(() => {
    mockPrisma = createMockPrismaService();
    service = new SystemParamsService(asPrismaService(mockPrisma));
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ─── findAll ──────────────────────────────────────────────────────────

  describe('findAll', () => {
    it('应返回所有参数并按 group+code 排序', async () => {
      const configs = [
        buildConfig({ id: 'cfg-1', group: 'general', code: 'A_PARAM' }),
        buildConfig({ id: 'cfg-2', group: 'general', code: 'B_PARAM' }),
        buildConfig({ id: 'cfg-3', group: 'notification', code: 'EMAIL' }),
      ];
      mockPrisma.systemConfig.findMany.mockResolvedValue(configs);

      const result = await service.findAll({});

      expect(mockPrisma.systemConfig.findMany).toHaveBeenCalledWith({
        where: {},
        orderBy: [{ group: 'asc' }, { code: 'asc' }],
      });
      expect(result.items).toHaveLength(3);
      expect(result.total).toBe(3);
    });

    it('应支持 group 筛选', async () => {
      const configs = [buildConfig({ group: 'notification', code: 'EMAIL' })];
      mockPrisma.systemConfig.findMany.mockResolvedValue(configs);

      const result = await service.findAll({ group: 'notification' });

      expect(mockPrisma.systemConfig.findMany).toHaveBeenCalledWith({
        where: { group: 'notification' },
        orderBy: [{ group: 'asc' }, { code: 'asc' }],
      });
      expect(result.items).toHaveLength(1);
      expect(result.total).toBe(1);
    });

    it('应正确按 group 分组返回 grouped', async () => {
      const configs = [
        buildConfig({ id: 'cfg-1', group: 'general', code: 'A' }),
        buildConfig({ id: 'cfg-2', group: 'general', code: 'B' }),
        buildConfig({ id: 'cfg-3', group: 'notification', code: 'C' }),
      ];
      mockPrisma.systemConfig.findMany.mockResolvedValue(configs);

      const result = await service.findAll({});

      expect(Object.keys(result.grouped)).toHaveLength(2);
      expect(result.grouped['general']).toHaveLength(2);
      expect(result.grouped['notification']).toHaveLength(1);
    });
  });

  // ─── findOne ──────────────────────────────────────────────────────────

  describe('findOne', () => {
    it('应根据 id 返回单个参数', async () => {
      const config = buildConfig();
      mockPrisma.systemConfig.findUnique.mockResolvedValue(config);

      const result = await service.findOne('cfg-1');

      expect(mockPrisma.systemConfig.findUnique).toHaveBeenCalledWith({
        where: { id: 'cfg-1' },
      });
      expect(result.code).toBe('SYSTEM_NAME');
    });

    it('不存在时应抛出 NotFoundException', async () => {
      mockPrisma.systemConfig.findUnique.mockResolvedValue(null);

      await expect(service.findOne('not-exist')).rejects.toThrow(NotFoundException);
    });
  });

  // ─── findByCode ───────────────────────────────────────────────────────

  describe('findByCode', () => {
    it('应根据 code 返回参数', async () => {
      const config = buildConfig();
      mockPrisma.systemConfig.findUnique.mockResolvedValue(config);

      const result = await service.findByCode('SYSTEM_NAME');

      expect(mockPrisma.systemConfig.findUnique).toHaveBeenCalledWith({
        where: { code: 'SYSTEM_NAME' },
      });
      expect(result.code).toBe('SYSTEM_NAME');
    });

    it('不存在时应抛出 NotFoundException', async () => {
      mockPrisma.systemConfig.findUnique.mockResolvedValue(null);

      await expect(service.findByCode('NOT_EXIST')).rejects.toThrow(NotFoundException);
    });
  });

  // ─── update ───────────────────────────────────────────────────────────

  describe('update', () => {
    it('应使用乐观锁更新参数并递增 version', async () => {
      const config = buildConfig({ version: 3 });
      const updated = buildConfig({ version: 4, value: '新值' });
      mockPrisma.systemConfig.findUnique.mockResolvedValue(config);
      mockPrisma.systemConfig.update.mockResolvedValue(updated);

      const result = await service.update('cfg-1', {
        value: '新值',
        version: 3,
      } as Parameters<typeof service.update>[1]);

      expect(mockPrisma.systemConfig.update).toHaveBeenCalledWith({
        where: { id: 'cfg-1', version: 3 },
        data: expect.objectContaining({
          value: '新值',
          description: '描述',
          version: { increment: 1 },
        }),
      });
      expect(result.value).toBe('新值');
    });

    it('参数不存在时应抛出 NotFoundException', async () => {
      mockPrisma.systemConfig.findUnique.mockResolvedValue(null);

      await expect(
        service.update('not-exist', {
          value: '新值',
          version: 1,
        } as Parameters<typeof service.update>[1])
      ).rejects.toThrow(NotFoundException);
    });

    it('版本冲突(P2025)时应抛出 ConflictException', async () => {
      const config = buildConfig({ version: 2 });
      mockPrisma.systemConfig.findUnique.mockResolvedValue(config);
      mockPrisma.systemConfig.update.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Record not found', {
          code: 'P2025',
          clientVersion: '5.0.0',
        })
      );

      await expect(
        service.update('cfg-1', {
          value: '新值',
          version: 1,
        } as Parameters<typeof service.update>[1])
      ).rejects.toThrow(ConflictException);
    });
  });

  // ─── getValue ─────────────────────────────────────────────────────────

  describe('getValue', () => {
    it('string 类型应返回原始字符串值', async () => {
      const config = buildConfig({ type: 'string', value: '示例' });
      mockPrisma.systemConfig.findUnique.mockResolvedValue(config);

      const result = await service.getValue('SYSTEM_NAME');

      expect(result).toBe('示例');
    });

    it('number 类型应转换为数值', async () => {
      const config = buildConfig({ type: 'number', value: '42' });
      mockPrisma.systemConfig.findUnique.mockResolvedValue(config);

      const result = await service.getValue('MAX_RETRY');

      expect(result).toBe(42);
    });

    it('boolean 类型应转换为 true', async () => {
      const config = buildConfig({ type: 'boolean', value: 'True' });
      mockPrisma.systemConfig.findUnique.mockResolvedValue(config);

      const result = await service.getValue('ENABLE_FEATURE');

      expect(result).toBe(true);
    });

    it('boolean 类型应转换为 false', async () => {
      const config = buildConfig({ type: 'boolean', value: 'false' });
      mockPrisma.systemConfig.findUnique.mockResolvedValue(config);

      const result = await service.getValue('ENABLE_FEATURE');

      expect(result).toBe(false);
    });

    it('json 类型应解析为对象', async () => {
      const jsonValue = JSON.stringify({ theme: 'dark', lang: 'zh' });
      const config = buildConfig({ type: 'json', value: jsonValue });
      mockPrisma.systemConfig.findUnique.mockResolvedValue(config);

      const result = await service.getValue('UI_SETTINGS');

      expect(result).toEqual({ theme: 'dark', lang: 'zh' });
    });

    it('参数不存在时应返回 null', async () => {
      mockPrisma.systemConfig.findUnique.mockResolvedValue(null);

      const result = await service.getValue('NOT_EXIST');

      expect(result).toBeNull();
    });

    it('解析失败时应返回 null', async () => {
      const config = buildConfig({ type: 'json', value: '不是合法的JSON{' });
      mockPrisma.systemConfig.findUnique.mockResolvedValue(config);

      const result = await service.getValue('BAD_JSON');

      expect(result).toBeNull();
    });
  });
});
