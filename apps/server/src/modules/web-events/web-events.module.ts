import { Module } from '@nestjs/common';

import { WebEventsController } from './web-events.controller';
import { WebEventsService } from './web-events.service';

@Module({
  controllers: [WebEventsController],
  providers: [WebEventsService],
  exports: [WebEventsService],
})
export class WebEventsModule {}
