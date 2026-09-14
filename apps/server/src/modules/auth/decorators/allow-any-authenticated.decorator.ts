import { SetMetadata } from '@nestjs/common';

/**
 * 已登录即放行（语义豁免）装饰器
 *
 * 标记"任何已通过 JWT 认证的用户都可访问"的端点。
 * **与 @Public() 的区别**：@Public 完全跳过 JWT 校验（登录引导/健康检查用），
 * 而本装饰器仍需要登录态，只是不要求任何细粒度 RBAC 权限。
 *
 * 适用场景（典型）：
 *  - 跨业务模块复用的工具型「选人/选部门/字典」下拉接口（仅返回 id/name 等精简字段）
 *    例：/employees/all, /departments/all
 *    若挂 @RequirePermission，业务角色（如 DEVELOPER）一进带筛选条的页面就失效
 *  - self-scoped 自管理接口：用户管理自己的会话/通知/密码（已通过 @CurrentUser 行级隔离）
 *  - 通用配置回显：登录后即可读的 filter-schemes / table-preferences / notifications 未读数等
 *
 * **运行时行为**：显式允许已通过认证守卫的任意用户；未声明任何授权元数据的
 * route 会由 PermissionGuard fail-closed。
 * 引入本装饰器是为了让 azeroth doctor 的「装饰器漂移」检测能识别这是
 * 经审议的豁免，而非漏挂装饰器。所以应在源码注释中明示豁免理由。
 *
 * 不要用本装饰器豁免写动作（POST/PUT/PATCH/DELETE）——那种端点几乎一定
 * 需要细粒度权限或 管理员。
 */
export const ALLOW_ANY_AUTHENTICATED_KEY = 'allowAnyAuthenticated';
export const AllowAnyAuthenticatedUser = () => SetMetadata(ALLOW_ANY_AUTHENTICATED_KEY, true);
