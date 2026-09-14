import { Module } from '@nestjs/common';

import { XiaohongshuModule } from '../xiaohongshu/xiaohongshu.module';
import { XiaohongshuOauthController } from './xiaohongshu-oauth.controller';

@Module({
  imports: [XiaohongshuModule],
  controllers: [XiaohongshuOauthController],
})
export class XiaohongshuOauthModule {}
