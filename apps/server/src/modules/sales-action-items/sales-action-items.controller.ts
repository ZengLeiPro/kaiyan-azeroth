import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';

import {
  assertLargePageSizeAllowed,
  DataScopeService,
} from '../../common/services/data-scope.service';
import { CurrentUser, CurrentUserType } from '../auth/decorators/current-user.decorator';
import { RequirePermission } from '../auth/decorators/require-permission.decorator';
import {
  DoneSalesActionItemDto,
  IgnoreSalesActionItemDto,
  TransferSalesActionItemDto,
} from './dto/action-sales-action-item.dto';
import { CreateSalesActionItemDto } from './dto/create-sales-action-item.dto';
import { QuerySalesActionItemDto } from './dto/query-sales-action-item.dto';
import {
  SalesActionItemListResponseDto,
  SalesActionItemResponseDto,
} from './dto/sales-action-item-response.dto';
import { UpdateSalesActionItemDto } from './dto/update-sales-action-item.dto';
import { SalesActionItemsService } from './sales-action-items.service';

const MODULE = 'crm';
const MENU = 'sales_action_items';

@ApiTags('销售数据待办')
@ApiBearerAuth()
@Controller('sales-action-items')
export class SalesActionItemsController {
  constructor(
    private readonly salesActionItemsService: SalesActionItemsService,
    private readonly dataScopeService: DataScopeService
  ) {}

  // ============ 业务端点（必须声明在 :id 之前，否则 /my 被 :id 捕获）============

  @Get('my')
  @ApiOperation({ summary: '我的销售待办（强制 employeeId=当前登录人）' })
  @RequirePermission({ module: MODULE, menu: MENU, action: 'view' })
  findMine(
    @Query() query: QuerySalesActionItemDto,
    @CurrentUser() user: CurrentUserType,
    @Req() request: Request
  ): Promise<SalesActionItemListResponseDto> {
    return this.salesActionItemsService.findMine(query, user.id, request.query);
  }

  @Get('my/count')
  @ApiOperation({ summary: '我的未处理待办数量（卡片 badge / 红点）' })
  @RequirePermission({ module: MODULE, menu: MENU, action: 'view' })
  countMine(
    @Query() query: QuerySalesActionItemDto,
    @CurrentUser() user: CurrentUserType
  ): Promise<{ count: number }> {
    return this.salesActionItemsService.countMine(user.id, query.category);
  }

  @Post(':id/adopt')
  @ApiOperation({ summary: '一键采纳草稿 → 写跟进记录 → adopted（仅 keep_record 全称明确草稿）' })
  @RequirePermission({ module: MODULE, menu: MENU, action: 'edit' })
  async adopt(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserType
  ): Promise<SalesActionItemResponseDto> {
    const scope = await this.resolveScope(user);
    return this.salesActionItemsService.adopt(id, user, scope);
  }

  @Post(':id/ignore')
  @ApiOperation({ summary: '忽略待办（必填 resolveNote）→ ignored' })
  @RequirePermission({ module: MODULE, menu: MENU, action: 'edit' })
  async ignore(
    @Param('id') id: string,
    @Body() body: IgnoreSalesActionItemDto,
    @CurrentUser() user: CurrentUserType
  ): Promise<SalesActionItemResponseDto> {
    const scope = await this.resolveScope(user);
    return this.salesActionItemsService.ignore(id, body.resolveNote, user, scope);
  }

  @Post(':id/done')
  @ApiOperation({
    summary: '标记已办（必填 doneType + resolveNote；跟进情况可同步跟进记录）→ done',
  })
  @RequirePermission({ module: MODULE, menu: MENU, action: 'edit' })
  async done(
    @Param('id') id: string,
    @Body() body: DoneSalesActionItemDto,
    @CurrentUser() user: CurrentUserType
  ): Promise<SalesActionItemResponseDto> {
    const scope = await this.resolveScope(user);
    return this.salesActionItemsService.done(
      id,
      body.resolveNote,
      body.doneType,
      user,
      scope,
      body.keepRecord
    );
  }

  @Post(':id/transfer')
  @ApiOperation({ summary: '转交待办（全员视图角色；源待办 transferred，目标员工获得 pending）' })
  @RequirePermission({ module: MODULE, menu: MENU, action: 'edit' })
  async transfer(
    @Param('id') id: string,
    @Body() body: TransferSalesActionItemDto,
    @CurrentUser() user: CurrentUserType
  ): Promise<SalesActionItemResponseDto> {
    const scope = await this.resolveScope(user);
    if (Array.isArray(scope)) {
      throw new ForbiddenException('仅全员视图角色可转交销售待办');
    }
    return this.salesActionItemsService.transfer(
      id,
      body.targetEmployeeId,
      body.reason,
      user,
      scope
    );
  }

  @Post(':id/reopen')
  @ApiOperation({ summary: '已办结改回待办（仅 done → pending）' })
  @RequirePermission({ module: MODULE, menu: MENU, action: 'edit' })
  async reopen(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserType
  ): Promise<SalesActionItemResponseDto> {
    const scope = await this.resolveScope(user);
    return this.salesActionItemsService.reopen(id, user, scope);
  }

  @Post(':id/undo')
  @ApiOperation({ summary: '撤销已采纳（软删生成的跟进记录，回 pending；限当日 / ADMIN）' })
  @RequirePermission({ module: MODULE, menu: MENU, action: 'edit' })
  async undo(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserType
  ): Promise<SalesActionItemResponseDto> {
    const scope = await this.resolveScope(user);
    return this.salesActionItemsService.undo(id, user, scope === null, scope);
  }

  // ============ 标准 CRUD（CLI schema-driven 自动派生）============

  @Post()
  @ApiOperation({ summary: '建待办（夜间 Agent / 管理端；带 sourceRunId）' })
  @RequirePermission({ module: MODULE, menu: MENU, action: 'create' })
  async create(
    @Body() createDto: CreateSalesActionItemDto,
    @CurrentUser() user: CurrentUserType
  ): Promise<SalesActionItemResponseDto> {
    // 归属校验：viewScope=SELF（scope 为数组）只能给本人建待办；
    // viewScope=ALL（scope=null）可为任意销售建待办。
    const scope = await this.resolveScope(user);
    if (Array.isArray(scope) && !scope.includes(createDto.employeeId)) {
      throw new ForbiddenException('只能为本人创建待办（employeeId 超出数据范围）');
    }
    return this.salesActionItemsService.create(createDto, user);
  }

  @Get()
  @ApiOperation({ summary: '管理端全量待办（ADMIN/林审批按 employeeId/sourceRunId/status 筛）' })
  @RequirePermission({ module: MODULE, menu: MENU, action: 'view' })
  async findAll(
    @Query() query: QuerySalesActionItemDto,
    @CurrentUser() user: CurrentUserType,
    @Req() request: Request
  ): Promise<SalesActionItemListResponseDto> {
    const scope = await this.resolveScope(user);
    assertLargePageSizeAllowed(query.pageSize, scope);
    return this.salesActionItemsService.findAll(query, scope, undefined, request.query);
  }

  @Get(':id')
  @ApiOperation({ summary: '待办详情（非本人且非 ADMIN 返 403）' })
  @RequirePermission({ module: MODULE, menu: MENU, action: 'view' })
  async findOne(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserType
  ): Promise<SalesActionItemResponseDto> {
    const scope = await this.resolveScope(user);
    return this.salesActionItemsService.findOne(id, scope);
  }

  @Put(':id')
  @ApiOperation({ summary: '更新待办（乐观锁 version；管理端/内部修正）' })
  @RequirePermission({ module: MODULE, menu: MENU, action: 'edit' })
  async update(
    @Param('id') id: string,
    @Body() updateDto: UpdateSalesActionItemDto,
    @CurrentUser() user: CurrentUserType
  ): Promise<SalesActionItemResponseDto> {
    const scope = await this.resolveScope(user);
    return this.salesActionItemsService.update(id, updateDto, user, scope);
  }

  @Delete(':id')
  @ApiOperation({ summary: '删除待办（软删）' })
  @RequirePermission({ module: MODULE, menu: MENU, action: 'delete' })
  async remove(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserType
  ): Promise<{ success: boolean }> {
    const scope = await this.resolveScope(user);
    await this.salesActionItemsService.remove(id, user, scope);
    return { success: true };
  }

  /** 解析数据范围：viewScope=ALL → null；SELF → [本人 employeeId]。 */
  private resolveScope(user: CurrentUserType): Promise<string[] | null> {
    return this.dataScopeService.resolveChargerScope(user.id, user.roles, MODULE, MENU, {
      employeeId: user.employeeId,
    });
  }
}
