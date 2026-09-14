import { Module, OnModuleInit } from '@nestjs/common';

import { FilterSchemeRegistry } from '../../common/filter-scheme';
import { DingtalkMessengerModule } from '../dingtalk-messenger/dingtalk-messenger.module';
import { DingtalkTodoModule } from '../dingtalk-todo/dingtalk-todo.module';
import { FilterSchemesModule } from '../filter-schemes/filter-schemes.module';
import { FinanceModule } from '../finance/finance.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { ApprovalBusinessEffectDispatcher } from './approval-business-effect.dispatcher';
import { ApprovalChangeRequestsService } from './approval-change-requests.service';
import { ApprovalDingtalkCardBuilder } from './approval-dingtalk-card.builder';
import { ApprovalGuardService } from './approval-guard.service';
import { ApprovalNotificationOutboxCron } from './approval-notification-outbox.cron';
import { ApprovalNotificationOutboxService } from './approval-notification-outbox.service';
import { ApprovalNotifier } from './approval-notifier.service';
import { ApprovalQueryService } from './approval-query.service';
import { ApprovalTransitionEngine } from './approval-transition.engine';
import { ApprovalsController } from './approvals.controller';
import { APPROVAL_FILTER_REGISTRIES } from './approvals.filter-registry';
import { ApprovalsService } from './approvals.service';
import { ApproverResolverService } from './approver-resolver.service';
import { BusinessApprovalService } from './business-approval.service';

@Module({
  imports: [
    NotificationsModule,
    DingtalkMessengerModule,
    DingtalkTodoModule,
    FinanceModule,
    FilterSchemesModule,
  ],
  controllers: [ApprovalsController],
  providers: [
    ApprovalsService,
    ApproverResolverService,
    ApprovalGuardService,
    ApprovalChangeRequestsService,
    BusinessApprovalService,
    ApprovalDingtalkCardBuilder,
    ApprovalNotifier,
    ApprovalNotificationOutboxService,
    ApprovalNotificationOutboxCron,
    ApprovalQueryService,
    ApprovalBusinessEffectDispatcher,
    ApprovalTransitionEngine,
  ],
  exports: [
    ApprovalsService,
    ApprovalGuardService,
    ApprovalChangeRequestsService,
    BusinessApprovalService,
  ],
})
export class ApprovalsModule implements OnModuleInit {
  constructor(private readonly filterSchemeRegistry: FilterSchemeRegistry) {}

  onModuleInit(): void {
    for (const registry of APPROVAL_FILTER_REGISTRIES) {
      this.filterSchemeRegistry.register(registry);
    }
  }
}
