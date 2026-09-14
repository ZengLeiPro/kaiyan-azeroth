import { Module } from '@nestjs/common';

import { DingtalkAuth } from './dingtalk-auth.service';

/**
 * 钉钉 access_token 共享模块（dingtalk-core 子层）
 *
 * 仅包含 DingtalkAuth provider，独立成 Module 是为了让
 * DingtalkSyncModule（手动同步日志/日历）与 DingtalkMessengerModule（审批工作通知）
 * 共享同一个 NestJS singleton 实例，从而共享 access_token 内存缓存，
 * 避免分别向 /gettoken 重复请求。
 *
 * dingtalk-core 物理上独立于 dingtalk-sync 目录，确保未来下线 dingtalk-sync 时
 * 不会牵连 DingtalkMessengerModule 等仍在使用的下行能力。
 */
@Module({
  providers: [DingtalkAuth],
  exports: [DingtalkAuth],
})
export class DingtalkAuthModule {}
