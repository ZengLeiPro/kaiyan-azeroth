import type { PrismaService } from '../../common/prisma/prisma.service';
import { createCustomer, type CustomerData } from './customer.factory';

let saleOrderSeq = 0;

export interface SaleOrderData {
  id: string;
  serialNumber: string;
  orderTitle: string | null;
  customerId: string;
  opportunityId: string | null;
  orderAmount: number | null;
  productAmount: number | null;
  totalReceivables: number | null;
  totalReceived: number | null;
  totalUncollected: number | null;
  businessDate: Date | null;
  orderBeginDate: Date | null;
  orderEndDate: Date | null;
  orderStatus: string | null;
  chargerId: string | null;
  chargerName: string | null;
  remark: string | null;
  status: string;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
  createdBy: string | null;
  updatedBy: string | null;
  version: number;
}

export function buildSaleOrder(overrides: Partial<SaleOrderData> = {}): SaleOrderData {
  saleOrderSeq++;
  const seq = saleOrderSeq.toString().padStart(4, '0');
  const now = new Date();

  return {
    id: `order-test-${seq}`,
    serialNumber: `DD${seq}`,
    orderTitle: `测试订单${seq}`,
    customerId: overrides.customerId ?? `cust-placeholder-${seq}`,
    opportunityId: null,
    orderAmount: null,
    productAmount: null,
    totalReceivables: null,
    totalReceived: null,
    totalUncollected: null,
    businessDate: null,
    orderBeginDate: null,
    orderEndDate: null,
    orderStatus: null,
    chargerId: null,
    chargerName: null,
    remark: null,
    status: 'active',
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
 * 在数据库中创建 SaleOrder 记录
 * 如果未传 customerId，会自动创建一个 Customer
 */
export async function createSaleOrder(
  prisma: PrismaService,
  overrides: Partial<SaleOrderData> = {}
): Promise<SaleOrderData & { customer?: CustomerData }> {
  let customer: CustomerData | undefined;

  if (!overrides.customerId) {
    customer = await createCustomer(prisma);
    overrides = { ...overrides, customerId: customer.id };
  }

  const data = buildSaleOrder(overrides);
  const {
    id: _id,
    orderAmount,
    productAmount,
    totalReceivables,
    totalReceived,
    totalUncollected,
    ...createData
  } = data;

  const created = await prisma.saleOrder.create({
    data: {
      ...createData,
      orderAmount: orderAmount != null ? String(orderAmount) : null,
      productAmount: productAmount != null ? String(productAmount) : null,
      totalReceivables: totalReceivables != null ? String(totalReceivables) : null,
      totalReceived: totalReceived != null ? String(totalReceived) : null,
      totalUncollected: totalUncollected != null ? String(totalUncollected) : null,
    },
  });

  return {
    ...data,
    id: created.id,
    createdAt: created.createdAt,
    updatedAt: created.updatedAt,
    customer,
  };
}

export function resetSaleOrderSeq(): void {
  saleOrderSeq = 0;
}
