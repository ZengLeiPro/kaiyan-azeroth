import { Controller, Get } from '@nestjs/common';

import { DataScopeService } from '../../common/services/data-scope.service';
import { AllowAnyAuthenticatedUser } from '../auth/decorators/allow-any-authenticated.decorator';
import { CurrentUser, CurrentUserType } from '../auth/decorators/current-user.decorator';
import { DashboardService, DashboardStats } from './dashboard.service';

@Controller('dashboard')
export class DashboardController {
  constructor(
    private readonly dashboardService: DashboardService,
    private readonly dataScopeService: DataScopeService
  ) {}

  /**
   * 获取仪表盘统计数据
   * GET /api/v1/dashboard/stats
   */
  @Get('stats')
  @AllowAnyAuthenticatedUser()
  async getStats(@CurrentUser() user: CurrentUserType): Promise<DashboardStats> {
    const scope = await this.dataScopeService.resolveChargerScope(
      user.id,
      user.roles,
      'analytics',
      'overview',
      { employeeId: user.employeeId }
    );
    return this.dashboardService.getStats(scope);
  }
}
