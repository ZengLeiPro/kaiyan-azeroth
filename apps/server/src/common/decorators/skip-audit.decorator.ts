import { SetMetadata } from '@nestjs/common';

export const SKIP_AUDIT_KEY = 'skipAudit';

/**
 * 跳过操作日志记录
 *
 * 全局 OperationLogInterceptor 会自动记录所有 POST/PUT/PATCH/DELETE 请求到 operation_logs 表。
 * 对于以下场景应使用此装饰器跳过：
 * - 登录/登出（已通过 LoginLog 独立记录）
 * - 文件上传（不属于业务操作）
 * - 高频低价值端点（如标记通知已读、心跳类）
 * - 测试/健康检查端点
 *
 * 可标注在方法或类上。类级标注会跳过整个 controller 的所有写操作。
 *
 * @example
 * ```typescript
 * // 类级：跳过整个 controller
 * @SkipAudit()
 * @Controller('auth')
 * export class AuthController { ... }
 *
 * // 方法级：仅跳过单个端点
 * @SkipAudit()
 * @Patch(':id/read')
 * markRead(@Param('id') id: string) { ... }
 * ```
 */
export const SkipAudit = () => SetMetadata(SKIP_AUDIT_KEY, true);
