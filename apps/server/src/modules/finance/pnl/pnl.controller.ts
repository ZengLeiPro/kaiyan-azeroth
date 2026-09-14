import type { FinanceLedgerResponseOutput, FinancePnlResponse } from '@ky-azeroth/shared/schemas';
import { Controller, Get, Query } from '@nestjs/common';

import type { PaginatedResponse } from '../../../common/interfaces/pagination.interface';
import { RequirePermission } from '../../auth/decorators/require-permission.decorator';
import { QueryFinancePnlDrilldownDto, QueryFinancePnlDto } from './dto/query-pnl.dto';
import { FinancePnlService } from './pnl.service';

@Controller('finance-pnl')
export class FinancePnlController {
  constructor(private readonly service: FinancePnlService) {}

  @Get()
  @RequirePermission({ module: 'finance', menu: 'pnl', action: 'view' })
  getPnl(@Query() query: QueryFinancePnlDto): Promise<FinancePnlResponse> {
    return this.service.getPnl(query);
  }

  @Get('drilldown')
  @RequirePermission({ module: 'finance', menu: 'pnl', action: 'view' })
  drilldown(
    @Query() query: QueryFinancePnlDrilldownDto
  ): Promise<PaginatedResponse<FinanceLedgerResponseOutput>> {
    return this.service.drilldown(query);
  }
}
