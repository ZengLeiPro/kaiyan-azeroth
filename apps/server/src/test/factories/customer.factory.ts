import type { PrismaService } from '../../common/prisma/prisma.service';

let customerSeq = 0;

export interface CustomerData {
  id: string;
  serialNumber: string;
  customerName: string;
  shortName: string | null;
  industry: string | null;
  customerLevel: string | null;
  customerSource: string | null;
  customerRelationship: string | null;
  customerTags: string[] | null;
  country: string | null;
  province: string | null;
  city: string | null;
  district: string | null;
  address: string | null;
  remark: string | null;
  aiInfoSummary: string | null;
  aiInfoGeneratedAt: Date | null;
  organizationId: string | null;
  uncId: string | null;
  headcountRange: string | null;
  chargerId: string | null;
  chargerName: string | null;
  collaboratorName: string | null;
  contactStatus: string | null;
  dealStatus: string | null;
  leadStage: string | null;
  leadStageUpdatedAt: Date | null;
  leadStageUpdatedById: string | null;
  leadStageQualifiedById: string | null;
  leadStageQualifiedAt: Date | null;
  firstMqlAt: Date | null;
  firstSqlAt: Date | null;
  leadProgressStatus: string | null;
  leadAppointmentAt: Date | null;
  leadProgressReason: string | null;
  leadProgressUpdatedAt: Date | null;
  leadProgressUpdatedById: string | null;
  status: string;
  accountsReceivable: number;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
  createdBy: string | null;
  updatedBy: string | null;
  version: number;
}

/**
 * 构建 Customer 内存对象（不写入数据库）
 */
export function buildCustomer(overrides: Partial<CustomerData> = {}): CustomerData {
  customerSeq++;
  const seq = customerSeq.toString().padStart(4, '0');
  const now = new Date();

  return {
    id: `cust-test-${seq}`,
    serialNumber: `KH${seq}`,
    customerName: `测试客户${seq}`,
    shortName: null,
    industry: null,
    customerLevel: null,
    customerSource: null,
    customerRelationship: null,
    customerTags: null,
    country: null,
    province: null,
    city: null,
    district: null,
    address: null,
    remark: null,
    aiInfoSummary: null,
    aiInfoGeneratedAt: null,
    organizationId: null,
    uncId: null,
    headcountRange: null,
    chargerId: null,
    chargerName: null,
    collaboratorName: null,
    contactStatus: null,
    dealStatus: null,
    leadStage: null,
    leadStageUpdatedAt: null,
    leadStageUpdatedById: null,
    leadStageQualifiedById: null,
    leadStageQualifiedAt: null,
    firstMqlAt: null,
    firstSqlAt: null,
    leadProgressStatus: null,
    leadAppointmentAt: null,
    leadProgressReason: null,
    leadProgressUpdatedAt: null,
    leadProgressUpdatedById: null,
    status: 'active',
    accountsReceivable: 0,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    createdBy: null,
    updatedBy: null,
    version: 1,
    ...overrides,
  };
}

/**
 * 在数据库中创建 Customer 记录
 */
export async function createCustomer(
  prisma: PrismaService,
  overrides: Partial<CustomerData> = {}
): Promise<CustomerData> {
  const data = buildCustomer(overrides);
  const { id: _id, accountsReceivable, customerTags, ...createData } = data;

  const created = await prisma.customer.create({
    data: {
      ...createData,
      accountsReceivable: String(accountsReceivable),
      customerTags: customerTags ?? undefined,
    },
  });

  return {
    ...data,
    id: created.id,
    createdAt: created.createdAt,
    updatedAt: created.updatedAt,
  };
}

/**
 * 重置序号计数器（在 beforeEach 中调用）
 */
export function resetCustomerSeq(): void {
  customerSeq = 0;
}
