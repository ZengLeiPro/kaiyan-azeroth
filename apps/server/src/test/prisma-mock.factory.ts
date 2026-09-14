import { vi } from 'vitest';

import type { PrismaService } from '../common/prisma/prisma.service';

type MockDelegate = {
  findFirst: ReturnType<typeof vi.fn>;
  findMany: ReturnType<typeof vi.fn>;
  findUnique: ReturnType<typeof vi.fn>;
  create: ReturnType<typeof vi.fn>;
  createMany: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  updateMany: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
  deleteMany: ReturnType<typeof vi.fn>;
  count: ReturnType<typeof vi.fn>;
  upsert: ReturnType<typeof vi.fn>;
  aggregate: ReturnType<typeof vi.fn>;
  groupBy: ReturnType<typeof vi.fn>;
};

function createMockDelegate(): MockDelegate {
  return {
    findFirst: vi.fn(),
    findMany: vi.fn(),
    findUnique: vi.fn(),
    create: vi.fn(),
    createMany: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
    delete: vi.fn(),
    deleteMany: vi.fn(),
    count: vi.fn(),
    upsert: vi.fn(),
    aggregate: vi.fn(),
    groupBy: vi.fn(),
  };
}

export type MockPrismaService = {
  [K in
    | 'customer'
    | 'contact'
    | 'opportunity'
    | 'opportunityProduct'
    | 'saleOrder'
    | 'orderProduct'
    | 'employee'
    | 'employeeDepartment'
    | 'department'
    | 'user'
    | 'userRole'
    | 'role'
    | 'session'
    | 'payment'
    | 'paymentItem'
    | 'invoice'
    | 'operationLog'
    | 'project'
    | 'projectSaleOrder'
    | 'projectMember'
    | 'projectTicket'
    | 'effortRecord'
    | 'loginLog'
    | 'notification'
    | 'serialNumberCounter'
    | 'systemConfig'
    | 'filterScheme'
    | 'rolePermission'
    | 'salesActionItem'
    | 'websiteLeadImport'
    | 'keepRecord'
    | 'visitRecord'
    | 'crmProduct'
    | 'crmWorkDaily'
    | 'storeInspectionStandard'
    | 'dingtalkLog'
    | 'dingtalkCalendarEvent'
    | 'employeeLeave'
    | 'approvalFlow'
    | 'approvalFlowNode'
    | 'approvalInstance'
    | 'approvalChangeRequest'
    | 'approvalTask'
    | 'approvalRecord'
    | 'approvalNotificationOutbox'
    | 'syncState'
    | 'personalAccessToken'
    | 'payrollPeriod'
    | 'payrollRecord'
    | 'payrollImportBatch'
    | 'financeAccount'
    | 'financeSubject'
    | 'financeLedger'
    | 'financePersonalLedger'
    | 'financeImportBatch'
    | 'webEvent'
    | 'holiday']: MockDelegate;
} & {
  $transaction: ReturnType<typeof vi.fn>;
  $queryRaw: ReturnType<typeof vi.fn>;
  $executeRaw: ReturnType<typeof vi.fn>;
  $queryRawUnsafe: ReturnType<typeof vi.fn>;
  $executeRawUnsafe: ReturnType<typeof vi.fn>;
};

/**
 * 创建 PrismaService 的 mock 实例
 *
 * $transaction mock 会将自身作为 tx 参数传入回调函数，
 * 确保 tx.xxx.create() 走同一套 mock。
 */
export function createMockPrismaService(): MockPrismaService {
  const mock: MockPrismaService = {
    customer: createMockDelegate(),
    contact: createMockDelegate(),
    opportunity: createMockDelegate(),
    opportunityProduct: createMockDelegate(),
    saleOrder: createMockDelegate(),
    orderProduct: createMockDelegate(),
    employee: createMockDelegate(),
    employeeDepartment: createMockDelegate(),
    department: createMockDelegate(),
    user: createMockDelegate(),
    userRole: createMockDelegate(),
    role: createMockDelegate(),
    session: createMockDelegate(),
    payment: createMockDelegate(),
    paymentItem: createMockDelegate(),
    invoice: createMockDelegate(),
    operationLog: createMockDelegate(),
    project: createMockDelegate(),
    projectSaleOrder: createMockDelegate(),
    projectMember: createMockDelegate(),
    projectTicket: createMockDelegate(),
    effortRecord: createMockDelegate(),
    loginLog: createMockDelegate(),
    notification: createMockDelegate(),
    serialNumberCounter: createMockDelegate(),
    systemConfig: createMockDelegate(),
    filterScheme: createMockDelegate(),
    rolePermission: createMockDelegate(),
    salesActionItem: createMockDelegate(),
    websiteLeadImport: createMockDelegate(),
    keepRecord: createMockDelegate(),
    visitRecord: createMockDelegate(),
    crmProduct: createMockDelegate(),
    crmWorkDaily: createMockDelegate(),
    storeInspectionStandard: createMockDelegate(),
    dingtalkLog: createMockDelegate(),
    dingtalkCalendarEvent: createMockDelegate(),
    employeeLeave: createMockDelegate(),
    approvalFlow: createMockDelegate(),
    approvalFlowNode: createMockDelegate(),
    approvalInstance: createMockDelegate(),
    approvalChangeRequest: createMockDelegate(),
    approvalTask: createMockDelegate(),
    approvalRecord: createMockDelegate(),
    approvalNotificationOutbox: createMockDelegate(),
    syncState: createMockDelegate(),
    personalAccessToken: createMockDelegate(),
    payrollPeriod: createMockDelegate(),
    payrollRecord: createMockDelegate(),
    payrollImportBatch: createMockDelegate(),
    financeAccount: createMockDelegate(),
    financeSubject: createMockDelegate(),
    financeLedger: createMockDelegate(),
    financePersonalLedger: createMockDelegate(),
    financeImportBatch: createMockDelegate(),
    webEvent: createMockDelegate(),
    holiday: createMockDelegate(),
    $transaction: vi.fn(),
    $queryRaw: vi.fn(),
    $executeRaw: vi.fn(),
    $queryRawUnsafe: vi.fn(),
    $executeRawUnsafe: vi.fn(),
  };

  // $transaction 默认实现：将 mock 自身作为 tx 传入回调
  mock.$transaction.mockImplementation(
    async (fnOrArray: ((tx: MockPrismaService) => Promise<unknown>) | unknown[]) => {
      if (typeof fnOrArray === 'function') {
        return fnOrArray(mock);
      }
      // 顺序执行数组形式的 Promise
      return Promise.all(fnOrArray);
    }
  );

  return mock;
}

/**
 * 将 MockPrismaService 转换为 PrismaService 类型（用于注入）
 */
export function asPrismaService(mock: MockPrismaService): PrismaService {
  return mock as unknown as PrismaService;
}
