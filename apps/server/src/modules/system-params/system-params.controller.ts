import { Body, Controller, Get, Param, Put, Query } from '@nestjs/common';

import { CurrentUser, CurrentUserType } from '../auth/decorators/current-user.decorator';
import { RequirePermission } from '../auth/decorators/require-permission.decorator';
import {
  QuerySystemConfigDto,
  SystemParamGroupedListResponseDto,
  SystemParamResponseDto,
  UpdateSystemParamDto,
} from './dto';
import { SystemParamsService } from './system-params.service';

@Controller('system-params')
export class SystemParamsController {
  constructor(private readonly systemParamsService: SystemParamsService) {}

  @Get()
  @RequirePermission({ module: 'system', menu: 'system_config', action: 'view' })
  findAll(@Query() query: QuerySystemConfigDto): Promise<SystemParamGroupedListResponseDto> {
    return this.systemParamsService.findAll(query);
  }

  @Get(':id')
  @RequirePermission({ module: 'system', menu: 'system_config', action: 'view' })
  findOne(@Param('id') id: string): Promise<SystemParamResponseDto> {
    return this.systemParamsService.findOne(id);
  }

  @Get('code/:code')
  @RequirePermission({ module: 'system', menu: 'system_config', action: 'view' })
  findByCode(@Param('code') code: string): Promise<SystemParamResponseDto> {
    return this.systemParamsService.findByCode(code);
  }

  @Put(':id')
  @RequirePermission({ module: 'system', menu: 'system_config', action: 'edit' })
  update(
    @Param('id') id: string,
    @Body() updateDto: UpdateSystemParamDto,
    @CurrentUser() user: CurrentUserType
  ): Promise<SystemParamResponseDto> {
    return this.systemParamsService.update(id, updateDto, user);
  }
}
