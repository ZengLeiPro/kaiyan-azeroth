import type { PrismaService } from '../../common/prisma/prisma.service';

let crmProductSeq = 0;

export interface CrmProductData {
  id: string;
  yccrmId: string | null;
  productName: string;
  productNumber: string | null;
  productTypes: string | null;
  productUnit: string | null;
  standardPrice: number | null;
  productStatus: string | null;
  remark: string | null;
  status: string;
  createdAt: Date;
  createdBy: string | null;
  updatedAt: Date;
  updatedBy: string | null;
  deletedAt: Date | null;
  version: number;
}

export function buildCrmProduct(overrides: Partial<CrmProductData> = {}): CrmProductData {
  crmProductSeq++;
  const seq = crmProductSeq.toString().padStart(4, '0');
  const now = new Date();

  return {
    id: `crm-product-test-${seq}`,
    yccrmId: null,
    productName: `测试产品${seq}`,
    productNumber: `CP${seq}`,
    productTypes: '标准产品',
    productUnit: '个',
    standardPrice: 100,
    productStatus: 'on_sale',
    remark: null,
    status: 'active',
    createdAt: now,
    updatedAt: now,
    createdBy: null,
    updatedBy: null,
    deletedAt: null,
    version: 1,
    ...overrides,
  };
}

export async function createCrmProduct(
  prisma: PrismaService,
  overrides: Partial<CrmProductData> = {}
): Promise<CrmProductData> {
  const data = buildCrmProduct(overrides);
  const { id: _id, standardPrice, ...createData } = data;

  const created = await prisma.crmProduct.create({
    data: {
      ...createData,
      standardPrice: standardPrice != null ? String(standardPrice) : null,
    },
  });

  return {
    ...data,
    id: created.id,
    createdAt: created.createdAt,
    updatedAt: created.updatedAt,
  };
}

export function resetCrmProductSeq(): void {
  crmProductSeq = 0;
}
