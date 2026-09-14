/**
 * 官网留资导入幂等台账。
 *
 * 对应 Prisma model `WebsiteLeadImport`。该表是机器台账，不是人工操作的线索业务表；
 * 实际 CRM 流转落在 Customer / Contact / SalesActionItem。
 */
export interface IWebsiteLeadImport {
  id: string;
  sourceId: string;
  phone: string;
  status: string;
  customerId?: string | null;
  actionItemId?: string | null;
  sourceSite?: string | null;
  sourcePath?: string | null;
  placement?: string | null;
  channel?: string | null;
  payload?: Record<string, unknown> | null;
  importedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}
