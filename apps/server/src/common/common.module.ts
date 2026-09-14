import { Global, Module } from '@nestjs/common';

import { AmapReverseGeocodeService } from './geocoding/amap-reverse-geocode.service';
import { DataScopeService } from './services/data-scope.service';
import { EmployeePermissionCacheService } from './services/employee-permission-cache.service';
import { SerialNumberService } from './services/serial-number.service';

/**
 * 公共模块
 *
 * 提供全局共享的服务，包括：
 * - SerialNumberService: 业务编号生成服务
 * - DataScopeService: 数据范围解析服务（按角色+部门过滤可见数据）
 * - EmployeePermissionCacheService: auth 路径 employee+roles+permissions 缓存
 */
@Global()
@Module({
  providers: [
    SerialNumberService,
    DataScopeService,
    EmployeePermissionCacheService,
    AmapReverseGeocodeService,
  ],
  exports: [
    SerialNumberService,
    DataScopeService,
    EmployeePermissionCacheService,
    AmapReverseGeocodeService,
  ],
})
export class CommonModule {}
