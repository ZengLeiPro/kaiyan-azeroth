import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put } from '@nestjs/common';

import { AllowAnyAuthenticatedUser } from '../auth/decorators/allow-any-authenticated.decorator';
import { CurrentUser, type CurrentUserType } from '../auth/decorators/current-user.decorator';
import { RequireFreshJwt } from '../auth/decorators/fresh-jwt.decorator';
import { RequirePermission } from '../auth/decorators/require-permission.decorator';
import {
  CreatePersonalFilterPresetDto,
  FilterSchemeDetailResponseDto,
  FilterSchemeListResponseDto,
  FilterSchemeVersionMapResponseDto,
  PersonalFilterPreferenceResponseDto,
  PersonalFilterPresetDto,
  PersonalFilterPresetListResponseDto,
  UpdateFilterSchemeDto,
  UpdatePersonalFilterPreferenceDto,
  UpdatePersonalFilterPresetDto,
} from './dto';
import { FilterSchemesService } from './filter-schemes.service';
import { PersonalFilterSchemesService } from './personal-filter-schemes.service';

@Controller('filter-schemes')
export class FilterSchemesController {
  constructor(
    private readonly filterSchemesService: FilterSchemesService,
    private readonly personalFilterSchemesService: PersonalFilterSchemesService
  ) {}

  @Get()
  @RequirePermission({ module: 'system', menu: 'filter_schemes', action: 'view' })
  list(): Promise<FilterSchemeListResponseDto> {
    return this.filterSchemesService.list();
  }

  @Get('version-map')
  @AllowAnyAuthenticatedUser()
  getVersionMap(): Promise<FilterSchemeVersionMapResponseDto> {
    return this.filterSchemesService.getVersionMap();
  }

  @Get(':pageKey/personal-preference')
  @AllowAnyAuthenticatedUser()
  getPersonalPreference(
    @Param('pageKey') pageKey: string,
    @CurrentUser() user: CurrentUserType
  ): Promise<PersonalFilterPreferenceResponseDto | null> {
    return this.personalFilterSchemesService.getPreference(pageKey, user.id);
  }

  @Put(':pageKey/personal-preference')
  @AllowAnyAuthenticatedUser()
  replacePersonalPreference(
    @Param('pageKey') pageKey: string,
    @Body() dto: UpdatePersonalFilterPreferenceDto,
    @CurrentUser() user: CurrentUserType
  ): Promise<PersonalFilterPreferenceResponseDto> {
    return this.personalFilterSchemesService.replacePreference(pageKey, dto, user.id);
  }

  @Delete(':pageKey/personal-preference')
  @AllowAnyAuthenticatedUser()
  @HttpCode(204)
  async resetPersonalPreference(
    @Param('pageKey') pageKey: string,
    @CurrentUser() user: CurrentUserType
  ): Promise<void> {
    await this.personalFilterSchemesService.resetPreference(pageKey, user.id);
  }

  @Get(':pageKey/personal-presets')
  @AllowAnyAuthenticatedUser()
  listPersonalPresets(
    @Param('pageKey') pageKey: string,
    @CurrentUser() user: CurrentUserType
  ): Promise<PersonalFilterPresetListResponseDto> {
    return this.personalFilterSchemesService.listPresets(pageKey, user.id);
  }

  @Post(':pageKey/personal-presets')
  @AllowAnyAuthenticatedUser()
  createPersonalPreset(
    @Param('pageKey') pageKey: string,
    @Body() dto: CreatePersonalFilterPresetDto,
    @CurrentUser() user: CurrentUserType
  ): Promise<PersonalFilterPresetDto> {
    return this.personalFilterSchemesService.createPreset(pageKey, dto, user.id);
  }

  @Put('personal-presets/:id')
  @AllowAnyAuthenticatedUser()
  updatePersonalPreset(
    @Param('id') id: string,
    @Body() dto: UpdatePersonalFilterPresetDto,
    @CurrentUser() user: CurrentUserType
  ): Promise<PersonalFilterPresetDto> {
    return this.personalFilterSchemesService.updatePreset(id, dto, user.id);
  }

  @Delete('personal-presets/:id/:version')
  @AllowAnyAuthenticatedUser()
  @HttpCode(204)
  async deletePersonalPreset(
    @Param('id') id: string,
    @Param('version') version: string,
    @CurrentUser() user: CurrentUserType
  ): Promise<void> {
    await this.personalFilterSchemesService.deletePreset(id, Number(version), user.id);
  }

  @Get(':pageKey')
  @AllowAnyAuthenticatedUser()
  getDetail(@Param('pageKey') pageKey: string): Promise<FilterSchemeDetailResponseDto> {
    return this.filterSchemesService.getDetail(pageKey);
  }

  @Put(':pageKey')
  @RequirePermission({ module: 'system', menu: 'filter_schemes', action: 'edit' })
  @RequireFreshJwt()
  replace(
    @Param('pageKey') pageKey: string,
    @Body() dto: UpdateFilterSchemeDto,
    @CurrentUser() user: CurrentUserType
  ): Promise<FilterSchemeDetailResponseDto> {
    return this.filterSchemesService.replace(pageKey, dto, user);
  }

  @Post(':pageKey/reset')
  @RequirePermission({ module: 'system', menu: 'filter_schemes', action: 'edit' })
  @RequireFreshJwt()
  reset(
    @Param('pageKey') pageKey: string,
    @CurrentUser() user: CurrentUserType
  ): Promise<FilterSchemeDetailResponseDto> {
    return this.filterSchemesService.reset(pageKey, user);
  }
}
