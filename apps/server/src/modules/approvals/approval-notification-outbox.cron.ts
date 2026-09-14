import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { ApprovalNotificationOutboxService } from './approval-notification-outbox.service';

@Injectable()
export class ApprovalNotificationOutboxCron {
  private readonly logger = new Logger(ApprovalNotificationOutboxCron.name);

  constructor(private readonly outbox: ApprovalNotificationOutboxService) {}

  @Cron('* * * * *', { timeZone: 'Asia/Shanghai' })
  async deliverPending(): Promise<void> {
    try {
      await this.outbox.deliverPending();
    } catch (error) {
      this.logger.error(
        `审批通知发件箱轮询失败: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
}
