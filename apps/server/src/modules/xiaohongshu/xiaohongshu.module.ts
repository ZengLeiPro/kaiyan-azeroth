import { Module } from '@nestjs/common';

import { XiaohongshuCoreModule } from '../xiaohongshu-core';
import { XiaohongshuController } from './xiaohongshu.controller';
import { XiaohongshuService } from './xiaohongshu.service';
import { XiaohongshuCronService } from './xiaohongshu-cron.service';
import { XiaohongshuDatasetService } from './xiaohongshu-dataset.service';
import { XiaohongshuOauthService } from './xiaohongshu-oauth.service';
import { XiaohongshuTokenService } from './xiaohongshu-token.service';

@Module({
  imports: [XiaohongshuCoreModule],
  controllers: [XiaohongshuController],
  providers: [
    XiaohongshuOauthService,
    XiaohongshuTokenService,
    XiaohongshuService,
    XiaohongshuDatasetService,
    XiaohongshuCronService,
  ],
  exports: [XiaohongshuOauthService, XiaohongshuTokenService, XiaohongshuService],
})
export class XiaohongshuModule {}
