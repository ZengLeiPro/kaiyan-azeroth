import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { FinanceModule } from '../modules/finance/finance.module';
import { CliBundleController } from './cli-bundle.controller';
import { InternalController } from './internal.controller';

@Module({
  imports: [ConfigModule, FinanceModule],
  controllers: [InternalController, CliBundleController],
})
export class InternalModule {}
