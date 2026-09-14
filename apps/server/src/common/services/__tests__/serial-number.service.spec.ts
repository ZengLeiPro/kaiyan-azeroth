import { vi } from 'vitest';

import {
  asPrismaService,
  createMockPrismaService,
  type MockPrismaService,
} from '../../../test/prisma-mock.factory';
import { SerialNumberType } from '../../constants/serial-number.constants';
import { SerialNumberService } from '../serial-number.service';

describe('SerialNumberService', () => {
  let service: SerialNumberService;
  let mockPrisma: MockPrismaService;

  beforeEach(() => {
    mockPrisma = createMockPrismaService();
    service = new SerialNumberService(asPrismaService(mockPrisma));

    // Mock sleep to avoid real delays in tests
    vi.spyOn(
      service as unknown as { sleep: (ms: number) => Promise<void> },
      'sleep'
    ).mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  describe('generate', () => {
    it('should generate serial number with prefix (no date) - e.g. CUSTOMER returns CUS00001', async () => {
      mockPrisma.$queryRaw.mockResolvedValue([{ counter: 1 }]);
      mockPrisma.$queryRawUnsafe.mockResolvedValue([{ count: BigInt(0) }]);

      const result = await service.generate(SerialNumberType.CUSTOMER);

      expect(result).toBe('CUS00001');
      expect(mockPrisma.$queryRaw).toHaveBeenCalledTimes(1);
    });

    it('should generate serial number with date - e.g. APPROVAL returns APR{YYMMDD}001', async () => {
      mockPrisma.$queryRaw.mockResolvedValue([{ counter: 1 }]);

      // Mock Date to get predictable output
      const mockDate = new Date(2026, 2, 5); // 2026-03-05
      vi.useFakeTimers({ now: mockDate });

      const result = await service.generate(SerialNumberType.APPROVAL);

      vi.useRealTimers();

      expect(result).toBe('APR260305001');
      expect(mockPrisma.$queryRaw).toHaveBeenCalledTimes(1);
      // APPROVAL has hasDate=true, so no conflict check
      expect(mockPrisma.$queryRawUnsafe).not.toHaveBeenCalled();
    });

    it('should throw Error for unknown type', async () => {
      await expect(service.generate('UNKNOWN_TYPE' as SerialNumberType)).rejects.toThrow(
        'Unknown serial number type: UNKNOWN_TYPE'
      );
    });

    it('should auto-fix and retry on conflict (checkExists returns true once, then false)', async () => {
      // First call: counter=1, conflict detected
      // After fix: counter=2, no conflict
      mockPrisma.$queryRaw
        .mockResolvedValueOnce([{ counter: 1 }])
        .mockResolvedValueOnce([{ counter: 2 }]);

      // First check: exists (conflict), second check: not exists
      mockPrisma.$queryRawUnsafe
        .mockResolvedValueOnce([{ count: BigInt(1) }]) // checkSerialNumberExists -> true
        .mockResolvedValueOnce([{ serialNumber: 'CUS00001' }]) // autoFixCounter -> find max
        .mockResolvedValueOnce([{ count: BigInt(0) }]); // checkSerialNumberExists -> false (after retry)

      mockPrisma.$executeRawUnsafe.mockResolvedValue(1); // autoFixCounter update

      const result = await service.generate(SerialNumberType.CUSTOMER);

      expect(result).toBe('CUS00002');
      expect(mockPrisma.$queryRaw).toHaveBeenCalledTimes(2);
    });

    it('should throw Error when max retries reached', async () => {
      // All attempts produce conflict
      mockPrisma.$queryRaw.mockResolvedValue([{ counter: 1 }]);
      mockPrisma.$queryRawUnsafe
        .mockResolvedValueOnce([{ count: BigInt(1) }]) // attempt 1: exists
        .mockResolvedValueOnce([{ serialNumber: 'CUS00001' }]) // attempt 1: autoFix find max
        .mockResolvedValueOnce([{ count: BigInt(1) }]) // attempt 2: exists
        .mockResolvedValueOnce([{ serialNumber: 'CUS00001' }]) // attempt 2: autoFix find max
        .mockResolvedValueOnce([{ count: BigInt(1) }]) // attempt 3: exists
        .mockResolvedValueOnce([{ serialNumber: 'CUS00001' }]); // attempt 3: autoFix find max

      mockPrisma.$executeRawUnsafe.mockResolvedValue(1);

      await expect(service.generate(SerialNumberType.CUSTOMER, 3)).rejects.toThrow(
        '编号生成失败: CUSTOMER'
      );
    });

    it('should throw Error when auto-fix fails', async () => {
      mockPrisma.$queryRaw.mockResolvedValue([{ counter: 1 }]);

      // Conflict detected
      mockPrisma.$queryRawUnsafe
        .mockResolvedValueOnce([{ count: BigInt(1) }]) // checkSerialNumberExists -> true
        .mockResolvedValueOnce([{ serialNumber: 'CUSabc' }]); // autoFixCounter -> unparseable serial

      await expect(service.generate(SerialNumberType.CUSTOMER, 1)).rejects.toThrow(
        '计数器修复失败，无法生成编号 CUSTOMER'
      );
    });

    it('should generate EMPLOYEE type with correct prefix and length', async () => {
      mockPrisma.$queryRaw.mockResolvedValue([{ counter: 42 }]);
      mockPrisma.$queryRawUnsafe.mockResolvedValue([{ count: BigInt(0) }]);

      const result = await service.generate(SerialNumberType.EMPLOYEE);

      expect(result).toBe('E00042');
    });

    it('should generate DEPARTMENT type with correct prefix and length', async () => {
      // DEPARTMENT has no table mapping, so no conflict check
      mockPrisma.$queryRaw.mockResolvedValue([{ counter: 7 }]);

      const result = await service.generate(SerialNumberType.DEPARTMENT);

      expect(result).toBe('DEPT-007');
      expect(mockPrisma.$queryRawUnsafe).not.toHaveBeenCalled();
    });

    it('should generate SALE_ORDER type correctly', async () => {
      mockPrisma.$queryRaw.mockResolvedValue([{ counter: 123 }]);
      mockPrisma.$queryRawUnsafe.mockResolvedValue([{ count: BigInt(0) }]);

      const result = await service.generate(SerialNumberType.SALE_ORDER);

      expect(result).toBe('SO00123');
    });

    it('should handle $queryRaw failure and retry', async () => {
      mockPrisma.$queryRaw
        .mockRejectedValueOnce(new Error('DB connection error'))
        .mockResolvedValueOnce([{ counter: 1 }]);

      mockPrisma.$queryRawUnsafe.mockResolvedValue([{ count: BigInt(0) }]);

      const result = await service.generate(SerialNumberType.CUSTOMER, 3);

      expect(result).toBe('CUS00001');
      expect(mockPrisma.$queryRaw).toHaveBeenCalledTimes(2);
    });
  });

  describe('generateBatch', () => {
    it('should generate batch of sequential numbers (count=3)', async () => {
      // When count=3, endSeq=counter, startSeq=counter-3+1
      mockPrisma.$queryRaw.mockResolvedValue([{ counter: 5 }]);

      const results = await service.generateBatch(SerialNumberType.CUSTOMER, 3);

      expect(results).toEqual(['CUS00003', 'CUS00004', 'CUS00005']);
      expect(results).toHaveLength(3);
    });

    it('should return empty array when count <= 0', async () => {
      const result0 = await service.generateBatch(SerialNumberType.CUSTOMER, 0);
      const resultNeg = await service.generateBatch(SerialNumberType.CUSTOMER, -1);

      expect(result0).toEqual([]);
      expect(resultNeg).toEqual([]);
      expect(mockPrisma.$queryRaw).not.toHaveBeenCalled();
    });

    it('should pad sequence numbers correctly (padStart)', async () => {
      // EMPLOYEE has seqLength=5
      mockPrisma.$queryRaw.mockResolvedValue([{ counter: 3 }]);

      const results = await service.generateBatch(SerialNumberType.EMPLOYEE, 3);

      expect(results).toEqual(['E00001', 'E00002', 'E00003']);
    });

    it('should generate batch with date prefix for APPROVAL type', async () => {
      const mockDate = new Date(2026, 2, 5); // 2026-03-05
      vi.useFakeTimers({ now: mockDate });

      mockPrisma.$queryRaw.mockResolvedValue([{ counter: 3 }]);

      const results = await service.generateBatch(SerialNumberType.APPROVAL, 3);

      vi.useRealTimers();

      expect(results).toEqual(['APR260305001', 'APR260305002', 'APR260305003']);
    });

    it('should throw Error for unknown type in batch', async () => {
      await expect(service.generateBatch('UNKNOWN_TYPE' as SerialNumberType, 5)).rejects.toThrow(
        'Unknown serial number type: UNKNOWN_TYPE'
      );
    });

    it('should generate single item batch correctly', async () => {
      mockPrisma.$queryRaw.mockResolvedValue([{ counter: 10 }]);

      const results = await service.generateBatch(SerialNumberType.PAYMENT, 1);

      expect(results).toEqual(['PAY00010']);
      expect(results).toHaveLength(1);
    });

    it('should handle DEPARTMENT prefix with dash correctly', async () => {
      mockPrisma.$queryRaw.mockResolvedValue([{ counter: 2 }]);

      const results = await service.generateBatch(SerialNumberType.DEPARTMENT, 2);

      expect(results).toEqual(['DEPT-001', 'DEPT-002']);
    });

    it('should handle large counter values without truncation', async () => {
      // Counter exceeds seqLength padding - verify no truncation
      mockPrisma.$queryRaw.mockResolvedValue([{ counter: 100005 }]);

      const results = await service.generateBatch(SerialNumberType.CUSTOMER, 5);

      // startSeq = 100005 - 5 + 1 = 100001, seqLength=5 but number is 6 digits
      expect(results).toEqual(['CUS100001', 'CUS100002', 'CUS100003', 'CUS100004', 'CUS100005']);
    });
  });
});
