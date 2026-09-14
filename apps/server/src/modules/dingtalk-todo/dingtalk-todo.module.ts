import { Module } from '@nestjs/common';

import { DingtalkAuthModule } from '../dingtalk-core/dingtalk-auth.module';
import { DingtalkTodoService } from './dingtalk-todo.service';

@Module({
  imports: [DingtalkAuthModule],
  providers: [DingtalkTodoService],
  exports: [DingtalkTodoService],
})
export class DingtalkTodoModule {}
