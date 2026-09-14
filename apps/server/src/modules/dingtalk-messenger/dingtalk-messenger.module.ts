import { Module } from '@nestjs/common';

import { DingtalkAuthModule } from '../dingtalk-core/dingtalk-auth.module';
import { DingtalkMessengerService } from './dingtalk-messenger.service';

/**
 * 钉钉下行消息模块
 *
 * 暴露 DingtalkMessengerService，供其他模块（如 ApprovalsModule）
 * 向钉钉企业内部应用「工作通知」下发 OA action_card 等消息。
 *
 * 与 DingtalkSyncModule 通过 DingtalkAuthModule 共享 access_token 缓存。
 */
@Module({
  imports: [DingtalkAuthModule],
  providers: [DingtalkMessengerService],
  exports: [DingtalkMessengerService],
})
export class DingtalkMessengerModule {}
