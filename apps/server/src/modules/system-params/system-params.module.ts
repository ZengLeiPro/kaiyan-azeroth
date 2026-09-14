import { Module } from '@nestjs/common';

import { PrismaModule } from '../../common/prisma/prisma.module';
import { SystemParamsController } from './system-params.controller';
import { SystemParamsService } from './system-params.service';

@Module({
  imports: [PrismaModule],
  controllers: [SystemParamsController],
  providers: [SystemParamsService],
  exports: [SystemParamsService],
})
export class SystemParamsModule {}
