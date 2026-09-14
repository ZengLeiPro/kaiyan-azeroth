import { Module } from '@nestjs/common';

import { CustomerLifecycleService } from './customer-lifecycle.service';

@Module({
  providers: [CustomerLifecycleService],
  exports: [CustomerLifecycleService],
})
export class CustomerLifecycleModule {}
