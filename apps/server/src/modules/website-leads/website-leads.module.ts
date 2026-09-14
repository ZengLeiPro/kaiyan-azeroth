import { Module } from '@nestjs/common';

import { WebsiteLeadsController } from './website-leads.controller';
import { WebsiteLeadsService } from './website-leads.service';

@Module({
  controllers: [WebsiteLeadsController],
  providers: [WebsiteLeadsService],
})
export class WebsiteLeadsModule {}
