import {
  xiaohongshuDailyReportQuerySchema,
  xiaohongshuDatasetCatalogQuerySchema,
  xiaohongshuDatasetQuerySchema,
  xiaohongshuManualSyncBodySchema,
  xiaohongshuRankingQuerySchema,
  xiaohongshuSummaryQuerySchema,
  xiaohongshuSyncRunQuerySchema,
  xiaohongshuTrendQuerySchema,
} from '@ky-azeroth/shared/schemas';
import { createZodDto } from 'nestjs-zod';

export class XiaohongshuManualSyncDto extends createZodDto(xiaohongshuManualSyncBodySchema) {}
export class XiaohongshuDailyReportQueryDto extends createZodDto(
  xiaohongshuDailyReportQuerySchema
) {}
export class XiaohongshuSyncRunQueryDto extends createZodDto(xiaohongshuSyncRunQuerySchema) {}
export class XiaohongshuSummaryQueryDto extends createZodDto(xiaohongshuSummaryQuerySchema) {}
export class XiaohongshuTrendQueryDto extends createZodDto(xiaohongshuTrendQuerySchema) {}
export class XiaohongshuRankingQueryDto extends createZodDto(xiaohongshuRankingQuerySchema) {}
export class XiaohongshuDatasetCatalogQueryDto extends createZodDto(
  xiaohongshuDatasetCatalogQuerySchema
) {}
export class XiaohongshuDatasetQueryDto extends createZodDto(xiaohongshuDatasetQuerySchema) {}
