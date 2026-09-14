import type { PayrollResponseOutput } from '@ky-azeroth/shared/schemas';
import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
} from '@nestjs/common';

import type { PaginatedResponse } from '../../common/interfaces/pagination.interface';
import { CurrentUser, CurrentUserType } from '../auth/decorators/current-user.decorator';
import { RequirePermission } from '../auth/decorators/require-permission.decorator';
import { CreatePayrollDto } from './dto/create-payroll.dto';
import {
  BatchPayrollDeleteDto,
  PayrollImportCommitDto,
  PayrollImportPreviewDto,
} from './dto/import-payroll.dto';
import {
  PayrollImportBatchListResponseDto,
  PayrollImportBatchResponseDto,
  PayrollImportCommitResponseDto,
  PayrollImportPreviewResponseDto,
  PayrollPeriodListResponseDto,
} from './dto/payroll-response.dto';
import { QueryPayrollDto } from './dto/query-payroll.dto';
import { UpdatePayrollDto } from './dto/update-payroll.dto';
import { PayrollService } from './payroll.service';
import { PayrollImportService } from './services/payroll-import.service';

@Controller('payroll')
export class PayrollController {
  constructor(
    private readonly payrollService: PayrollService,
    private readonly payrollImportService: PayrollImportService
  ) {}

  @Get('periods')
  @RequirePermission({ module: 'finance', menu: 'payroll', action: 'view' })
  async listPeriods(): Promise<PayrollPeriodListResponseDto> {
    return this.payrollService.listPeriods() as unknown as PayrollPeriodListResponseDto;
  }

  @Get('import-batches')
  @RequirePermission({ module: 'finance', menu: 'payroll_import', action: 'view' })
  async listImportBatches(): Promise<PayrollImportBatchListResponseDto> {
    return this.payrollImportService.listImportBatches() as unknown as PayrollImportBatchListResponseDto;
  }

  @Get('import-batches/:id')
  @RequirePermission({ module: 'finance', menu: 'payroll_import', action: 'view' })
  async getImportBatch(@Param('id') id: string): Promise<PayrollImportBatchResponseDto> {
    return this.payrollImportService.getImportBatch(id) as unknown as PayrollImportBatchResponseDto;
  }

  @Post('import/preview')
  @RequirePermission({ module: 'finance', menu: 'payroll_import', action: 'create' })
  async previewImport(
    @Body() dto: PayrollImportPreviewDto
  ): Promise<PayrollImportPreviewResponseDto> {
    return this.payrollImportService.previewImport(dto.fileAssetId);
  }

  @Post('import/commit')
  @RequirePermission({ module: 'finance', menu: 'payroll_import', action: 'create' })
  async commitImport(
    @Body() dto: PayrollImportCommitDto,
    @CurrentUser() user: CurrentUserType
  ): Promise<PayrollImportCommitResponseDto> {
    return this.payrollImportService.commitImport(dto.fileAssetId, dto.strategy, user);
  }

  @Get()
  @RequirePermission({ module: 'finance', menu: 'payroll', action: 'view' })
  async findAll(
    @Query() query: QueryPayrollDto
  ): Promise<PaginatedResponse<PayrollResponseOutput>> {
    return this.payrollService.findAll(query);
  }

  @Get(':id')
  @RequirePermission({ module: 'finance', menu: 'payroll', action: 'view' })
  async findOne(@Param('id') id: string): Promise<PayrollResponseOutput> {
    return this.payrollService.findOne(id);
  }

  @Post()
  @RequirePermission({ module: 'finance', menu: 'payroll', action: 'create' })
  async create(
    @Body() dto: CreatePayrollDto,
    @CurrentUser() user: CurrentUserType
  ): Promise<PayrollResponseOutput> {
    return this.payrollService.create(dto, user);
  }

  @Put(':id')
  @RequirePermission({ module: 'finance', menu: 'payroll', action: 'edit' })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdatePayrollDto,
    @CurrentUser() user: CurrentUserType
  ): Promise<PayrollResponseOutput> {
    return this.payrollService.update(id, dto, user);
  }

  /** 标准批删契约；静态路由必须声明在 DELETE /:id 之前，避免被参数路由吞掉。 */
  @Delete('batch')
  @RequirePermission({ module: 'finance', menu: 'payroll', action: 'delete' })
  async batchRemove(
    @Body() dto: BatchPayrollDeleteDto,
    @CurrentUser() user: CurrentUserType
  ): Promise<{ success: number; failed: number; errors: Array<{ id: string; error: string }> }> {
    return this.payrollService.batchRemove(dto.ids, dto.versions, user);
  }

  /** 兼容既有 CLI/调用方；请求体与 DELETE /batch 使用同一严格版本化 schema。 */
  @Post('batch-delete')
  @RequirePermission({ module: 'finance', menu: 'payroll', action: 'delete' })
  async batchRemoveLegacy(
    @Body() dto: BatchPayrollDeleteDto,
    @CurrentUser() user: CurrentUserType
  ): Promise<{ success: number; failed: number; errors: Array<{ id: string; error: string }> }> {
    return this.payrollService.batchRemove(dto.ids, dto.versions, user);
  }

  @Delete(':id')
  @RequirePermission({ module: 'finance', menu: 'payroll', action: 'delete' })
  async remove(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserType,
    @Query('version') versionQuery?: string
  ): Promise<{ success: boolean }> {
    const requestVersion = parseVersionParam(versionQuery);
    await this.payrollService.remove(id, user, requestVersion);
    return { success: true };
  }
}

function parseVersionParam(raw: string | undefined): number {
  const version = Number(raw);
  if (typeof raw !== 'string' || raw === '' || !Number.isInteger(version) || version < 1) {
    throw new BadRequestException('删除薪资记录必须携带有效的 version');
  }
  return version;
}
