/**
 * 节假日设置实体类型（对应 Prisma Holiday model）
 *
 * HOLIDAY = 法定节假日（默认工作日 → 改休）
 * WORKDAY = 调休补班（默认周末 → 改上班）
 *
 * 完整契约（含 query/publish/response）见 packages/shared/src/schemas/holiday.ts。
 */
export interface IHoliday {
  id: string;
  /** ISO YYYY-MM-DD */
  date: string;
  year: number;
  type: string;
  note: string | null;
  createdAt?: string;
  createdBy?: string | null;
  updatedAt?: string;
  updatedBy?: string | null;
  deletedAt?: string | null;
  version?: number;
}
