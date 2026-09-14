import { Module } from '@nestjs/common';

import { DingtalkAuthModule } from '../dingtalk-core/dingtalk-auth.module';
import { DingtalkSyncController } from './dingtalk-sync.controller';
import { DingtalkSyncService } from './dingtalk-sync.service';

/**
 * 钉钉手动增量同步模块
 *
 * 提供两个仅 ADMIN 可访问的接口：
 * - POST /api/v1/dingtalk-sync/logs      增量同步工作日志
 * - POST /api/v1/dingtalk-sync/calendar  增量同步日历事件
 *
 * 历史背景：apps/dingtalk-sync 自 2026-05-01 起停用定时器（infra/s.dingtalk-sync.prod.yaml:13），
 * 本模块复刻其中的 logs/calendar 同步逻辑（部门来源改用本地 department 表），
 * 由前端报表页按钮按需触发。
 *
 * access_token 共享：通过 DingtalkAuthModule 导出 DingtalkAuth 单例，
 * 与 DingtalkMessengerModule 共享同一个 token 缓存。
 */
@Module({
  imports: [DingtalkAuthModule],
  controllers: [DingtalkSyncController],
  providers: [DingtalkSyncService],
})
export class DingtalkSyncModule {}
