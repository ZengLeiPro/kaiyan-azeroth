import { Controller, Get, Query } from '@nestjs/common';

import { RequirePermission } from '../auth/decorators/require-permission.decorator';
import {
  LoginLogListResponseDto,
  OperationLogListResponseDto,
} from './dto/operation-log-response.dto';
import { QueryLoginLogDto } from './dto/query-login-log.dto';
import { QueryOperationLogDto } from './dto/query-operation-log.dto';
import { OperationLogsService } from './operation-logs.service';

// 权限装饰器一致性（2026-06-13 audit 修复）：
// 原先用手写 `assertAdmin(user)` 内联函数做 ADMIN 角色校验，破坏了仓库
// "所有 endpoint 必须有显式权限装饰器" 的统一约定。改走 @RequirePermission
// 对接 RBAC 矩阵后，角色级控制由 system/roles 管理（system.operation_logs.view），
// 与 doctor.ts 的装饰器漂移检测对齐。

@Controller('operation-logs')
export class OperationLogsController {
  constructor(private readonly operationLogsService: OperationLogsService) {}

  @Get()
  @RequirePermission({ module: 'system', menu: 'operation_logs', action: 'view' })
  findAll(@Query() query: QueryOperationLogDto): Promise<OperationLogListResponseDto> {
    return this.operationLogsService.findAll(query);
  }
}

@Controller('login-logs')
export class LoginLogsController {
  constructor(private readonly operationLogsService: OperationLogsService) {}

  @Get()
  // login_logs 与 operation_logs 同菜单（shared/modules.ts 只挂了 operation_logs），
  // 共用一个权限项即可，不为登录日志单独建菜单
  @RequirePermission({ module: 'system', menu: 'operation_logs', action: 'view' })
  findAll(@Query() query: QueryLoginLogDto): Promise<LoginLogListResponseDto> {
    return this.operationLogsService.findLoginLogs(query);
  }
}
