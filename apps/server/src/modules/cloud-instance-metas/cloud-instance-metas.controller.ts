import type { CloudInstanceMetaResponseOutput } from '@ky-azeroth/shared/schemas/cloud-instance-meta';
import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import type { PaginatedResponse } from '../../common/interfaces/pagination.interface';
import { CurrentUser, CurrentUserType } from '../auth/decorators/current-user.decorator';
import { RequirePermission } from '../auth/decorators/require-permission.decorator';
import { CloudInstanceMetasService } from './cloud-instance-metas.service';
import { CreateCloudInstanceMetaDto } from './dto/create-cloud-instance-meta.dto';
import { QueryCloudInstanceMetaDto } from './dto/query-cloud-instance-meta.dto';
import { UpdateCloudInstanceMetaDto } from './dto/update-cloud-instance-meta.dto';

@ApiTags('云实例元数据')
@ApiBearerAuth()
@Controller('cloud-instance-metas')
export class CloudInstanceMetasController {
  constructor(private readonly service: CloudInstanceMetasService) {}

  @Get()
  @ApiOperation({ summary: '查询云实例元数据列表' })
  @RequirePermission({ module: 'ops', menu: 'cloud_instances', action: 'view' })
  findAll(
    @Query() query: QueryCloudInstanceMetaDto
  ): Promise<PaginatedResponse<CloudInstanceMetaResponseOutput>> {
    return this.service.findAll(query);
  }

  @Get(':id')
  @ApiOperation({ summary: '查询云实例元数据详情' })
  @RequirePermission({ module: 'ops', menu: 'cloud_instances', action: 'view' })
  findOne(@Param('id') id: string): Promise<CloudInstanceMetaResponseOutput> {
    return this.service.findOne(id);
  }

  @Post()
  @ApiOperation({ summary: '新建云实例元数据' })
  @RequirePermission({ module: 'ops', menu: 'cloud_instances', action: 'edit' })
  create(
    @Body() dto: CreateCloudInstanceMetaDto,
    @CurrentUser() user: CurrentUserType
  ): Promise<CloudInstanceMetaResponseOutput> {
    return this.service.create(dto, user);
  }

  @Patch(':id')
  @ApiOperation({ summary: '更新云实例元数据（乐观锁）' })
  @RequirePermission({ module: 'ops', menu: 'cloud_instances', action: 'edit' })
  update(
    @Param('id') id: string,
    @Body() dto: UpdateCloudInstanceMetaDto,
    @CurrentUser() user: CurrentUserType
  ): Promise<CloudInstanceMetaResponseOutput> {
    return this.service.update(id, dto, user);
  }

  /**
   * PUT 别名：与 useCrud 默认的 PUT 语义兼容。
   * 业务逻辑与 PATCH 完全相同（service 内部走乐观锁 partial update）。
   */
  @Put(':id')
  @ApiOperation({ summary: '更新云实例元数据（PUT 别名，与 useCrud 兼容）' })
  @RequirePermission({ module: 'ops', menu: 'cloud_instances', action: 'edit' })
  updateAsPut(
    @Param('id') id: string,
    @Body() dto: UpdateCloudInstanceMetaDto,
    @CurrentUser() user: CurrentUserType
  ): Promise<CloudInstanceMetaResponseOutput> {
    return this.service.update(id, dto, user);
  }

  @Delete(':id')
  @ApiOperation({ summary: '删除云实例元数据（软删）' })
  @RequirePermission({ module: 'ops', menu: 'cloud_instances', action: 'edit' })
  async remove(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserType
  ): Promise<{ success: true }> {
    await this.service.remove(id, user);
    return { success: true };
  }
}
