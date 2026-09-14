import { Module, OnModuleInit } from '@nestjs/common';

import { FilterSchemeRegistry } from '../../common/filter-scheme';
import { FilterSchemesModule } from '../filter-schemes/filter-schemes.module';
import { CloudBillSnapshotsController } from './cloud-bill-snapshots.controller';
import { CLOUD_BILL_SNAPSHOT_FILTER_REGISTRY } from './cloud-bill-snapshots.filter-registry';
import { CloudBillSnapshotsService } from './cloud-bill-snapshots.service';

@Module({
  imports: [FilterSchemesModule],
  controllers: [CloudBillSnapshotsController],
  providers: [CloudBillSnapshotsService],
  exports: [CloudBillSnapshotsService],
})
export class CloudBillSnapshotsModule implements OnModuleInit {
  constructor(private readonly filterSchemeRegistry: FilterSchemeRegistry) {}

  onModuleInit(): void {
    this.filterSchemeRegistry.register(CLOUD_BILL_SNAPSHOT_FILTER_REGISTRY);
  }
}
