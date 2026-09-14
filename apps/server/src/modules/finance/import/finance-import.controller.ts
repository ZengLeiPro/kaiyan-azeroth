import type {
  FinanceImportBatchResponse,
  FinanceImportCommitResponse,
  FinanceImportPreviewResponse,
} from '@ky-azeroth/shared/schemas';
import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';

import type { PaginatedResponse } from '../../../common/interfaces/pagination.interface';
import { CurrentUser, CurrentUserType } from '../../auth/decorators/current-user.decorator';
import { RequirePermission } from '../../auth/decorators/require-permission.decorator';
import { FinanceImportCommitDto } from './dto/commit-import.dto';
import { FinanceImportPreviewDto } from './dto/preview-import.dto';
import { QueryFinanceImportBatchDto } from './dto/query-import-batch.dto';
import { FinanceImportService } from './services/finance-import.service';

@Controller('finance-import')
export class FinanceImportController {
  constructor(private readonly service: FinanceImportService) {}

  @Post('dingtalk/preview')
  @RequirePermission({ module: 'finance', menu: 'finance_import', action: 'create' })
  preview(
    @Body() dto: FinanceImportPreviewDto,
    @CurrentUser() user: CurrentUserType
  ): Promise<FinanceImportPreviewResponse> {
    return this.service.previewImport(dto, user);
  }

  @Post('dingtalk/commit')
  @RequirePermission({ module: 'finance', menu: 'finance_import', action: 'create' })
  commit(
    @Body() dto: FinanceImportCommitDto,
    @CurrentUser() user: CurrentUserType
  ): Promise<FinanceImportCommitResponse> {
    return this.service.commitImport(dto, user);
  }

  @Get('batches')
  @RequirePermission({ module: 'finance', menu: 'finance_import', action: 'view' })
  listBatches(
    @Query() query: QueryFinanceImportBatchDto
  ): Promise<PaginatedResponse<FinanceImportBatchResponse>> {
    return this.service.listBatches(query);
  }

  @Get('batches/:id')
  @RequirePermission({ module: 'finance', menu: 'finance_import', action: 'view' })
  getBatch(@Param('id') id: string): Promise<FinanceImportBatchResponse> {
    return this.service.getBatch(id);
  }
}
