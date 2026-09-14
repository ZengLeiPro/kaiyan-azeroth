import { Module } from '@nestjs/common';

import { XiaohongshuApiClient } from './xiaohongshu-api.client';
import { XiaohongshuTokenCryptoService } from './xiaohongshu-token-crypto.service';

@Module({
  providers: [XiaohongshuApiClient, XiaohongshuTokenCryptoService],
  exports: [XiaohongshuApiClient, XiaohongshuTokenCryptoService],
})
export class XiaohongshuCoreModule {}
