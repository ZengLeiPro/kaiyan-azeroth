import { Body, Controller, Delete, Get, Param, Post, Put, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';

import { CurrentUser, CurrentUserType } from '../auth/decorators/current-user.decorator';
import { RequirePermission } from '../auth/decorators/require-permission.decorator';
import { CrmProductsService } from './crm-products.service';
import { CreateCrmProductDto } from './dto/create-crm-product.dto';
import { CrmProductListResponseDto, CrmProductResponseDto } from './dto/crm-product-response.dto';
import { CrmProductSelectionQueryDto } from './dto/crm-product-selection-query.dto';
import { QueryCrmProductDto } from './dto/query-crm-product.dto';
import { UpdateCrmProductDto } from './dto/update-crm-product.dto';

@ApiTags('CRM 产品')
@ApiBearerAuth()
@Controller('crm-products')
export class CrmProductsController {
  constructor(private readonly crmProductsService: CrmProductsService) {}

  @Post()
  @ApiOperation({ summary: '创建产品' })
  @RequirePermission({ module: 'crm', menu: 'products', action: 'create' })
  create(
    @Body() createCrmProductDto: CreateCrmProductDto,
    @CurrentUser() user: CurrentUserType
  ): Promise<CrmProductResponseDto> {
    return this.crmProductsService.create(createCrmProductDto, user);
  }

  @Get('trash')
  @ApiOperation({ summary: '查询回收站产品列表' })
  @RequirePermission({ module: 'crm', menu: 'products', action: 'view' })
  findTrashed(@Query() query: QueryCrmProductDto): Promise<CrmProductListResponseDto> {
    return this.crmProductsService.findTrashed(query);
  }

  @Get()
  @ApiOperation({ summary: '查询产品列表' })
  @RequirePermission({ module: 'crm', menu: 'products', action: 'view' })
  findAll(
    @Query() query: QueryCrmProductDto,
    @Req() request: Request
  ): Promise<CrmProductListResponseDto> {
    return this.crmProductsService.findAll(query, request.query);
  }

  @Get('all')
  @ApiOperation({ summary: '查询所有产品（用于下拉框）' })
  @RequirePermission({ module: 'crm', menu: 'products', action: 'view' })
  findAllForSelection(@Query() query: CrmProductSelectionQueryDto): Promise<
    {
      id: string;
      productName: string;
      productNumber: string | null;
      productUnit: string | null;
      standardPrice: number | null;
    }[]
  > {
    return this.crmProductsService.findAllForSelection(query.keyword, query.productStatus);
  }

  @Get(':id')
  @ApiOperation({ summary: '查询产品详情' })
  @RequirePermission({ module: 'crm', menu: 'products', action: 'view' })
  findOne(@Param('id') id: string): Promise<CrmProductResponseDto> {
    return this.crmProductsService.findOne(id);
  }

  @Put(':id')
  @ApiOperation({ summary: '更新产品' })
  @RequirePermission({ module: 'crm', menu: 'products', action: 'edit' })
  update(
    @Param('id') id: string,
    @Body() updateCrmProductDto: UpdateCrmProductDto,
    @CurrentUser() user: CurrentUserType
  ): Promise<CrmProductResponseDto> {
    return this.crmProductsService.update(id, updateCrmProductDto, user);
  }

  @Post(':id/restore')
  @ApiOperation({ summary: '恢复已删除产品' })
  @RequirePermission({ module: 'crm', menu: 'products', action: 'edit' })
  restore(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserType
  ): Promise<CrmProductResponseDto> {
    return this.crmProductsService.restore(id, user);
  }

  @Delete(':id/permanent')
  @ApiOperation({ summary: '永久删除产品' })
  @RequirePermission({ module: 'crm', menu: 'products', action: 'delete' })
  async permanentRemove(@Param('id') id: string): Promise<{ success: boolean }> {
    await this.crmProductsService.permanentRemove(id);
    return { success: true };
  }

  @Delete(':id')
  @ApiOperation({ summary: '删除产品' })
  @RequirePermission({ module: 'crm', menu: 'products', action: 'delete' })
  async remove(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserType
  ): Promise<{ success: boolean }> {
    await this.crmProductsService.remove(id, user);
    return { success: true };
  }
}
