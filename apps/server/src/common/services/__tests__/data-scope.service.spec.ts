import {
  asPrismaService,
  createMockPrismaService,
  type MockPrismaService,
} from '../../../test/prisma-mock.factory';
import { applyCustomerCollabViaCustomerWriteScope, DataScopeService } from '../data-scope.service';

describe('DataScopeService', () => {
  let service: DataScopeService;
  let mockPrisma: MockPrismaService;

  beforeEach(() => {
    mockPrisma = createMockPrismaService();
    service = new DataScopeService(asPrismaService(mockPrisma));
  });

  it('ADMIN 角色也读取配置的 SELF/ALL 数据范围', async () => {
    mockPrisma.rolePermission.findMany.mockResolvedValue([{ viewScope: 'SELF' }]);
    const result = await service.resolveChargerScope('u1', ['ADMIN'], 'crm', 'customers');
    expect(result).toEqual(['u1']);
    expect(mockPrisma.rolePermission.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          role: expect.objectContaining({ status: 'active' }),
        }),
      })
    );
  });

  it('无 employeeId 返回 []', async () => {
    const result = await service.resolveChargerScope('', ['SALES'], 'crm', 'customers');
    expect(result).toEqual([]);
  });

  it('单角色 SELF → [employeeId]', async () => {
    mockPrisma.rolePermission.findMany.mockResolvedValue([{ viewScope: 'SELF' }]);
    const result = await service.resolveChargerScope('e1', ['SALES'], 'crm', 'customers');
    expect(result).toEqual(['e1']);
  });

  it('单角色 ALL → null', async () => {
    mockPrisma.rolePermission.findMany.mockResolvedValue([{ viewScope: 'ALL' }]);
    const result = await service.resolveChargerScope('e1', ['CRM_MANAGER'], 'crm', 'customers');
    expect(result).toBeNull();
  });

  it('多角色 [SELF, ALL] → null（取最大范围）', async () => {
    mockPrisma.rolePermission.findMany.mockResolvedValue([
      { viewScope: 'SELF' },
      { viewScope: 'ALL' },
    ]);
    const result = await service.resolveChargerScope(
      'e1',
      ['SALES', 'CRM_MANAGER'],
      'crm',
      'customers'
    );
    expect(result).toBeNull();
  });

  it('无 RolePermission 行 → [employeeId]（默认 SELF 兜底）', async () => {
    mockPrisma.rolePermission.findMany.mockResolvedValue([]);
    const result = await service.resolveChargerScope('e1', ['SALES'], 'crm', 'customers');
    expect(result).toEqual(['e1']);
  });

  it('第二个请求立即看见共享 DB 中 SELF → ALL 的授权变更', async () => {
    mockPrisma.rolePermission.findMany
      .mockResolvedValueOnce([{ viewScope: 'SELF' }])
      .mockResolvedValueOnce([{ viewScope: 'ALL' }]);

    await expect(service.resolveChargerScope('e1', ['SALES'], 'crm', 'customers')).resolves.toEqual(
      ['e1']
    );
    await expect(
      service.resolveChargerScope('e1', ['SALES'], 'crm', 'customers')
    ).resolves.toBeNull();
    expect(mockPrisma.rolePermission.findMany).toHaveBeenCalledTimes(2);
  });

  it('第二个请求立即看见共享 DB 中 ALL → SELF 的授权收紧', async () => {
    mockPrisma.rolePermission.findMany
      .mockResolvedValueOnce([{ viewScope: 'ALL' }])
      .mockResolvedValueOnce([{ viewScope: 'SELF' }]);

    await expect(
      service.resolveChargerScope('e1', ['CRM_MANAGER'], 'crm', 'customers')
    ).resolves.toBeNull();
    await expect(
      service.resolveChargerScope('e1', ['CRM_MANAGER'], 'crm', 'customers')
    ).resolves.toEqual(['e1']);
    expect(mockPrisma.rolePermission.findMany).toHaveBeenCalledTimes(2);
  });

  it('options.employeeId 优先于 userId', async () => {
    mockPrisma.rolePermission.findMany.mockResolvedValue([{ viewScope: 'SELF' }]);
    const result = await service.resolveChargerScope('u1', ['SALES'], 'crm', 'customers', {
      employeeId: 'e2',
    });
    expect(result).toEqual(['e2']);
    expect(mockPrisma.rolePermission.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          module: 'crm',
          menu: 'customers',
          role: expect.objectContaining({
            status: 'active',
            users: { some: { employeeId: 'e2' } },
          }),
        }),
      })
    );
  });
});

describe('applyCustomerCollabViaCustomerWriteScope', () => {
  it('写入范围包含负责人和协作人，但不继承公海读取兜底', () => {
    const where: Record<string, unknown> = { id: 'order-1' };

    applyCustomerCollabViaCustomerWriteScope(where, ['employee-1'], 'employee-1');

    expect(where).toEqual({
      id: 'order-1',
      OR: [
        { chargerId: { in: ['employee-1'] } },
        { customer: { chargerId: { in: ['employee-1'] } } },
        { customer: { collaboratorIds: { array_contains: ['employee-1'] } } },
      ],
    });
  });
});
