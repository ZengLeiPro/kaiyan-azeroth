import { Module, OnModuleInit } from '@nestjs/common';

import { FilterSchemeRegistry } from '../../common/filter-scheme';
import { DingtalkMessengerModule } from '../dingtalk-messenger/dingtalk-messenger.module';
import { FilterSchemesModule } from '../filter-schemes/filter-schemes.module';
import { FinanceAccountsController } from './accounts/accounts.controller';
import { FINANCE_ACCOUNT_FILTER_REGISTRY } from './accounts/accounts.filter-registry';
import { FinanceAccountsService } from './accounts/accounts.service';
import { DingtalkCollectReconcileController } from './dingtalk-reconcile/dingtalk-collect-reconcile.controller';
import { DingtalkCollectReconcileService } from './dingtalk-reconcile/dingtalk-collect-reconcile.service';
import { DingtalkCollectReconcileWatchdog } from './dingtalk-reconcile/dingtalk-collect-reconcile.watchdog';
import {
  FINANCE_LEDGER_FILTER_REGISTRY,
  FINANCE_PERSONAL_LEDGER_FILTER_REGISTRY,
  FINANCE_PNL_FILTER_REGISTRY,
} from './finance.filter-registry';
import { FinanceImportController } from './import/finance-import.controller';
import { DingtalkWorkbookReaderService } from './import/services/dingtalk-workbook-reader.service';
import { FinanceImportService } from './import/services/finance-import.service';
import { FinanceLedgerController } from './ledger/ledger.controller';
import { FinanceLedgerService } from './ledger/ledger.service';
import { FinancePersonalLedgerController } from './personal-ledger/personal-ledger.controller';
import { FinancePersonalLedgerService } from './personal-ledger/personal-ledger.service';
import { FinancePnlController } from './pnl/pnl.controller';
import { FinancePnlService } from './pnl/pnl.service';
import { OrderProductReceivableController } from './receivables/order-product-receivable.controller';
import { OrderProductReceivableService } from './receivables/order-product-receivable.service';
import { OrderProductReceivableWatchdog } from './receivables/order-product-receivable.watchdog';
import { FinanceSubjectsController } from './subjects/subjects.controller';
import { FINANCE_SUBJECT_FILTER_REGISTRY } from './subjects/subjects.filter-registry';
import { FinanceSubjectsService } from './subjects/subjects.service';
import { FinanceLedgerSyncService } from './sync/finance-ledger-sync.service';

/**
 * 财务模块
 *
 * 7 子模块：accounts / subjects / ledger / personal-ledger / pnl / import / sync
 * 路由统一走 system/roles 权限配置。
 * sync 子模块仅暴露 FinanceLedgerSyncService（CRM 回款 ↔ 财务流水绑定方案 v2.1），
 * 无 controller、无路由，由 ApprovalsModule / PaymentsModule 注入使用。
 *
 * v2.2 Phase 7：imports DingtalkMessengerModule，供 receivables/dingtalk-reconcile
 * 两个 watchdog cron 失同步时推钉钉告警。DingtalkMessengerModule 不依赖 FinanceModule，
 * 无循环依赖风险。
 */
@Module({
  imports: [DingtalkMessengerModule, FilterSchemesModule],
  controllers: [
    FinanceAccountsController,
    FinanceSubjectsController,
    FinanceLedgerController,
    FinancePersonalLedgerController,
    FinancePnlController,
    FinanceImportController,
    OrderProductReceivableController,
    DingtalkCollectReconcileController,
  ],
  providers: [
    FinanceAccountsService,
    FinanceSubjectsService,
    FinanceLedgerService,
    FinancePersonalLedgerService,
    FinancePnlService,
    DingtalkWorkbookReaderService,
    FinanceImportService,
    FinanceLedgerSyncService,
    OrderProductReceivableService,
    OrderProductReceivableWatchdog,
    DingtalkCollectReconcileService,
    DingtalkCollectReconcileWatchdog,
  ],
  exports: [
    FinanceAccountsService,
    FinanceSubjectsService,
    FinanceLedgerService,
    FinancePersonalLedgerService,
    FinancePnlService,
    FinanceImportService,
    FinanceLedgerSyncService,
    OrderProductReceivableService,
    DingtalkCollectReconcileService,
  ],
})
export class FinanceModule implements OnModuleInit {
  constructor(private readonly filterSchemeRegistry: FilterSchemeRegistry) {}

  onModuleInit(): void {
    this.filterSchemeRegistry.register(FINANCE_ACCOUNT_FILTER_REGISTRY);
    this.filterSchemeRegistry.register(FINANCE_SUBJECT_FILTER_REGISTRY);
    this.filterSchemeRegistry.register(FINANCE_LEDGER_FILTER_REGISTRY);
    this.filterSchemeRegistry.register(FINANCE_PERSONAL_LEDGER_FILTER_REGISTRY);
    this.filterSchemeRegistry.register(FINANCE_PNL_FILTER_REGISTRY);
  }
}
