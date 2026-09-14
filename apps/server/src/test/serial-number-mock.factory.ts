import { vi } from 'vitest';

import type { SerialNumberService } from '../common/services/serial-number.service';

export interface MockSerialNumberService {
  generate: ReturnType<typeof vi.fn>;
  generateBatch: ReturnType<typeof vi.fn>;
}

/**
 * 创建 SerialNumberService 的 mock 实例
 *
 * generate() 默认返回递增编号 PREFIX0001, PREFIX0002, ...
 */
export function createMockSerialNumberService(prefix = 'TEST'): MockSerialNumberService {
  let counter = 0;

  const mock: MockSerialNumberService = {
    generate: vi.fn().mockImplementation(async () => {
      counter++;
      return `${prefix}${counter.toString().padStart(4, '0')}`;
    }),
    generateBatch: vi.fn().mockImplementation(async (_type: string, count: number) => {
      const results: string[] = [];
      for (let i = 0; i < count; i++) {
        counter++;
        results.push(`${prefix}${counter.toString().padStart(4, '0')}`);
      }
      return results;
    }),
  };

  return mock;
}

/**
 * 将 MockSerialNumberService 转换为 SerialNumberService 类型
 */
export function asSerialNumberService(mock: MockSerialNumberService): SerialNumberService {
  return mock as unknown as SerialNumberService;
}
