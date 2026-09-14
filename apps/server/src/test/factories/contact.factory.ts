import type { PrismaService } from '../../common/prisma/prisma.service';
import { createCustomer, type CustomerData } from './customer.factory';

let contactSeq = 0;

export interface ContactData {
  id: string;
  contactName: string;
  customerId: string;
  mobile: string | null;
  phone: string | null;
  email: string | null;
  wechat: string | null;
  position: string | null;
  department: string | null;
  status: string;
  sex: string | null;
  remark: string | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
  createdBy: string | null;
  updatedBy: string | null;
  version: number;
}

export function buildContact(overrides: Partial<ContactData> = {}): ContactData {
  contactSeq++;
  const seq = contactSeq.toString().padStart(4, '0');
  const now = new Date();

  return {
    id: `contact-test-${seq}`,
    contactName: `测试联系人${seq}`,
    customerId: overrides.customerId ?? `cust-placeholder-${seq}`,
    mobile: `1390000${seq}`,
    phone: null,
    email: null,
    wechat: null,
    position: null,
    department: null,
    status: 'active',
    sex: null,
    remark: null,
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
 * 在数据库中创建 Contact 记录
 * 如果未传 customerId，会自动创建一个 Customer
 */
export async function createContact(
  prisma: PrismaService,
  overrides: Partial<ContactData> = {}
): Promise<ContactData & { customer?: CustomerData }> {
  let customer: CustomerData | undefined;

  if (!overrides.customerId) {
    customer = await createCustomer(prisma);
    overrides = { ...overrides, customerId: customer.id };
  }

  const data = buildContact(overrides);
  const { id: _id, ...createData } = data;

  const created = await prisma.contact.create({ data: createData });

  return {
    ...data,
    id: created.id,
    createdAt: created.createdAt,
    updatedAt: created.updatedAt,
    customer,
  };
}

export function resetContactSeq(): void {
  contactSeq = 0;
}
