import { Module, OnModuleInit } from '@nestjs/common';

import { FilterSchemeRegistry } from '../../common/filter-scheme';
import { ApprovalsModule } from '../approvals/approvals.module';
import { FilterSchemesModule } from '../filter-schemes/filter-schemes.module';
import { ApprovalFlowsController } from './approval-flows.controller';
import {
  APPROVAL_FLOW_FILTER_REGISTRY,
  APPROVAL_SETTINGS_FILTER_REGISTRY,
} from './approval-flows.filter-registry';
import { ApprovalFlowsService } from './approval-flows.service';

@Module({
  imports: [ApprovalsModule, FilterSchemesModule],
  controllers: [ApprovalFlowsController],
  providers: [ApprovalFlowsService],
  exports: [ApprovalFlowsService],
})
export class ApprovalFlowsModule implements OnModuleInit {
  constructor(private readonly filterSchemeRegistry: FilterSchemeRegistry) {}

  onModuleInit(): void {
    this.filterSchemeRegistry.register(APPROVAL_FLOW_FILTER_REGISTRY);
    this.filterSchemeRegistry.register(APPROVAL_SETTINGS_FILTER_REGISTRY);
  }
}
