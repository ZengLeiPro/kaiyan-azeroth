import { UnprocessableEntityException } from '@nestjs/common';

import {
  asPrismaService,
  createMockPrismaService,
  type MockPrismaService,
} from '../../../test/prisma-mock.factory';
import { HolidaysService } from '../holidays.service';

/**
 * 工具：构造 holiday override 行（mock prisma.holiday.findMany 的返回项）。
 * Service 内部 toIsoDate 用 toISOString().slice(0,10)，因此 date 必须用 UTC 0 点。
 */
function buildOverrideRow(isoDate: string, type: 'HOLIDAY' | 'WORKDAY') {
  return {
    id: `holiday-${isoDate}`,
    date: new Date(`${isoDate}T00:00:00.000Z`),
    year: Number(isoDate.slice(0, 4)),
    type,
    note: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    version: 1,
  };
}

describe('HolidaysService', () => {
  let service: HolidaysService;
  let mockPrisma: MockPrismaService;

  beforeEach(() => {
    mockPrisma = createMockPrismaService();
    service = new HolidaysService(asPrismaService(mockPrisma));
  });

  describe('listWorkDates', () => {
    it('纯周末规则（无 holiday 记录）：返回 Mon-Fri', async () => {
      // 2026-03-02 (Mon) ~ 2026-03-08 (Sun) 一整周
      mockPrisma.holiday.findMany.mockResolvedValue([]);

      const result = await service.listWorkDates('2026-03-02', '2026-03-08');

      expect(result).toEqual([
        '2026-03-02', // Mon
        '2026-03-03', // Tue
        '2026-03-04', // Wed
        '2026-03-05', // Thu
        '2026-03-06', // Fri
      ]);
    });

    it('HOLIDAY 命中工作日：该日被排除', async () => {
      // 2026-10-01 (Thu) 国庆，标 HOLIDAY；其余 2026-09-30 (Wed) / 2026-10-02 (Fri) 应保留
      mockPrisma.holiday.findMany.mockResolvedValue([buildOverrideRow('2026-10-01', 'HOLIDAY')]);

      const result = await service.listWorkDates('2026-09-30', '2026-10-02');

      expect(result).toEqual(['2026-09-30', '2026-10-02']);
      expect(result).not.toContain('2026-10-01');
    });

    it('WORKDAY 命中周末（调休补班）：该日被包含', async () => {
      // 2026-09-26 (Sat) 调休补班，应被包含；2026-09-27 (Sun) 仍是周末休息
      mockPrisma.holiday.findMany.mockResolvedValue([buildOverrideRow('2026-09-26', 'WORKDAY')]);

      const result = await service.listWorkDates('2026-09-25', '2026-09-27');

      // 2026-09-25 (Fri) 工作日 + 2026-09-26 (Sat) 调休补班
      expect(result).toEqual(['2026-09-25', '2026-09-26']);
      expect(result).not.toContain('2026-09-27');
    });

    it('跨年范围：一次查询覆盖（含跨年元旦）', async () => {
      // 2026-12-31 (Thu) ~ 2027-01-04 (Mon)：2027-01-01 (Fri) 元旦放假
      mockPrisma.holiday.findMany.mockResolvedValue([buildOverrideRow('2027-01-01', 'HOLIDAY')]);

      const result = await service.listWorkDates('2026-12-31', '2027-01-04');

      // 2026-12-31 (Thu) 工作日；2027-01-01 (Fri) 元旦排除；
      // 2027-01-02 (Sat) / 2027-01-03 (Sun) 周末排除；2027-01-04 (Mon) 工作日
      expect(result).toEqual(['2026-12-31', '2027-01-04']);
      // 验证 findMany 只调用了一次（一次范围查询而非按年分次）
      expect(mockPrisma.holiday.findMany).toHaveBeenCalledTimes(1);
    });

    it('跨度 > 1830 天：listWorkDates 不再校验跨度（公共 API 限制只在 getCalendar）', async () => {
      // P1-6 整改：1830 天上限是 calendar 公共 API 的防 Agent 误传策略，
      // 不应泄漏到 effort-stats 等内部统计模块。listWorkDates 仅做 ISO + 顺序校验。
      mockPrisma.holiday.findMany.mockResolvedValue([]);
      await expect(service.listWorkDates('2026-01-01', '2031-12-31')).resolves.toBeDefined();
      expect(mockPrisma.holiday.findMany).toHaveBeenCalledTimes(1);
    });

    it('start > end：抛 UnprocessableEntityException', async () => {
      await expect(service.listWorkDates('2026-12-31', '2026-01-01')).rejects.toThrow(
        UnprocessableEntityException
      );
      expect(mockPrisma.holiday.findMany).not.toHaveBeenCalled();
    });

    it('start = end 单日工作日：返回该单日', async () => {
      mockPrisma.holiday.findMany.mockResolvedValue([]);
      const result = await service.listWorkDates('2026-03-04', '2026-03-04');
      expect(result).toEqual(['2026-03-04']);
    });

    it('start = end 单日周末：返回空', async () => {
      mockPrisma.holiday.findMany.mockResolvedValue([]);
      const result = await service.listWorkDates('2026-03-08', '2026-03-08');
      expect(result).toEqual([]);
    });

    it('HOLIDAY 命中周末：冗余覆盖，仍排除（与默认周末规则结果一致）', async () => {
      // 2026-03-07 (Sat) 被错误地标了 HOLIDAY——理论上没意义但不应反转语义
      mockPrisma.holiday.findMany.mockResolvedValue([buildOverrideRow('2026-03-07', 'HOLIDAY')]);
      const result = await service.listWorkDates('2026-03-06', '2026-03-08');
      // 2026-03-06 (Fri) 工作日 + 2026-03-07 (Sat) 仍排除 + 2026-03-08 (Sun) 仍排除
      expect(result).toEqual(['2026-03-06']);
    });

    it('WORKDAY 命中工作日：冗余覆盖，仍包含（与默认工作日规则结果一致）', async () => {
      // 2026-03-04 (Wed) 被错误地标了 WORKDAY——理论上没意义但不应反转语义
      mockPrisma.holiday.findMany.mockResolvedValue([buildOverrideRow('2026-03-04', 'WORKDAY')]);
      const result = await service.listWorkDates('2026-03-03', '2026-03-05');
      expect(result).toEqual(['2026-03-03', '2026-03-04', '2026-03-05']);
    });
  });

  describe('getCalendar', () => {
    it('跨度 > 1830 天：service 入口校验抛错（与 zod 双保险）', async () => {
      await expect(service.getCalendar('2026-01-01', '2031-12-31')).rejects.toThrow(
        UnprocessableEntityException
      );
      expect(mockPrisma.holiday.findMany).not.toHaveBeenCalled();
    });

    it('应返回结构完整的 workDates + restDates + overrides', async () => {
      // 2026-10-01 (Thu) HOLIDAY + 2026-09-26 (Sat) WORKDAY 的小窗口
      const overrides = [
        buildOverrideRow('2026-09-26', 'WORKDAY'),
        buildOverrideRow('2026-10-01', 'HOLIDAY'),
      ];
      mockPrisma.holiday.findMany.mockResolvedValue(overrides);

      const result = await service.getCalendar('2026-09-25', '2026-10-02');

      expect(result.startDate).toBe('2026-09-25');
      expect(result.endDate).toBe('2026-10-02');
      // workDates: 25(Fri) + 26(Sat 补班) + 28(Mon) + 29(Tue) + 30(Wed) + 02(Fri)
      expect(result.workDates).toEqual([
        '2026-09-25',
        '2026-09-26',
        '2026-09-28',
        '2026-09-29',
        '2026-09-30',
        '2026-10-02',
      ]);
      // restDates: 27(Sun) + 01(Thu 国庆)
      expect(result.restDates).toEqual(['2026-09-27', '2026-10-01']);
      // overrides 数组结构完整
      expect(result.overrides).toHaveLength(2);
      expect(result.overrides[0]).toMatchObject({ date: '2026-09-26', type: 'WORKDAY' });
      expect(result.overrides[1]).toMatchObject({ date: '2026-10-01', type: 'HOLIDAY' });
    });
  });
});
