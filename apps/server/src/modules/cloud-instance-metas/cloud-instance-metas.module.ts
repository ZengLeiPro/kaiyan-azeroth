import { Module, OnModuleInit } from '@nestjs/common';

import { FilterSchemeRegistry } from '../../common/filter-scheme';
import { FilterSchemesModule } from '../filter-schemes/filter-schemes.module';
import { CloudInstanceMetasController } from './cloud-instance-metas.controller';
import { CLOUD_INSTANCE_META_FILTER_REGISTRY } from './cloud-instance-metas.filter-registry';
import { CloudInstanceMetasService } from './cloud-instance-metas.service';

@Module({
  imports: [FilterSchemesModule],
  controllers: [CloudInstanceMetasController],
  providers: [CloudInstanceMetasService],
  exports: [CloudInstanceMetasService],
})
export class CloudInstanceMetasModule implements OnModuleInit {
  constructor(private readonly filterSchemeRegistry: FilterSchemeRegistry) {}

  onModuleInit(): void {
    this.filterSchemeRegistry.register(CLOUD_INSTANCE_META_FILTER_REGISTRY);
  }
}
