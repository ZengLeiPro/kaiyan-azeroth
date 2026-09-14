import { Body, Controller, Get, Put, Query } from '@nestjs/common';

import { AllowAnyAuthenticatedUser } from '../auth/decorators/allow-any-authenticated.decorator';
import { CurrentUser, type CurrentUserType } from '../auth/decorators/current-user.decorator';
import { RequireFreshJwt } from '../auth/decorators/fresh-jwt.decorator';
import { RequirePermission } from '../auth/decorators/require-permission.decorator';
import {
  QueryTablePreferenceDto,
  TablePreferenceResponseDto,
  UpsertTablePreferenceDto,
} from './dto';
import { TablePreferencesService } from './table-preferences.service';

@Controller('table-preferences')
export class TablePreferencesController {
  constructor(private readonly service: TablePreferencesService) {}

  /**
   * 任意已登录用户可读：客户端需要拿 server.version 与本地 appliedServerVersion 对比，
   * 决定是否强制覆盖。JwtAuthGuard 全局已兜底登录态。
   */
  @Get()
  @AllowAnyAuthenticatedUser()
  findByPageKey(
    @Query() query: QueryTablePreferenceDto
  ): Promise<TablePreferenceResponseDto | null> {
    return this.service.findByPageKey(query.pageKey);
  }

  /**
   * 站点级表格偏好写入：与筛选方案同属站点级 UI 配置，走 filter_schemes.edit。
   */
  @Put()
  @RequirePermission({ module: 'system', menu: 'filter_schemes', action: 'edit' })
  @RequireFreshJwt()
  upsert(
    @Body() body: UpsertTablePreferenceDto,
    @CurrentUser() user: CurrentUserType
  ): Promise<TablePreferenceResponseDto> {
    return this.service.upsert(body, user);
  }
}
