import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { PrismaService } from '../../../common/prisma/prisma.service';
import { ALLOW_ANY_AUTHENTICATED_KEY } from '../decorators/allow-any-authenticated.decorator';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import {
  PERMISSION_KEY,
  type RequiredPermissionConfig,
} from '../decorators/require-permission.decorator';

/**
 * 权限守卫
 *
 * 基于 RolePermission 表检查用户是否拥有所需的细粒度权限。
 * ADMIN 角色同样读取 system/roles 页面配置，不再自动放行。
 *
 * 需要配合 @RequirePermission 装饰器使用。
 * 每个 route 必须显式声明 @RequirePermission、@Public
 * 或 @AllowAnyAuthenticatedUser；没有授权元数据时运行时 fail-closed。
 * @RequireFreshJwt 只是 step-up，不能单独作为授权元数据。
 */
@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredPermission = this.reflector.getAllAndOverride<
      RequiredPermissionConfig | undefined
    >(PERMISSION_KEY, [context.getHandler(), context.getClass()]);

    const metadataTargets = [context.getHandler(), context.getClass()];
    if (!requiredPermission) {
      const isExplicitlyHandled =
        this.reflector.getAllAndOverride<boolean>(ALLOW_ANY_AUTHENTICATED_KEY, metadataTargets) ||
        this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, metadataTargets);
      if (isExplicitlyHandled) return true;
      throw new ForbiddenException('路由授权元数据缺失');
    }

    const request = context.switchToHttp().getRequest();
    const user = request.user;

    if (!user) {
      throw new ForbiddenException('未认证');
    }

    // push 5: user_roles 主键已切到 (employeeId, roleId)，直接用 employeeId 查
    const employeeId: string = user.employeeId ?? user.id;
    const requiredPermissions = Array.isArray(requiredPermission)
      ? requiredPermission
      : [requiredPermission];

    const permissionFilters = requiredPermissions.map((permission) => ({
      module: permission.module,
      menu: permission.menu,
    }));

    const permissions = await this.prisma.rolePermission.findMany({
      where: {
        role: {
          users: {
            some: { employeeId },
          },
          deletedAt: null,
          status: 'active',
        },
        OR: permissionFilters,
      },
    });

    // 检查是否有任意角色拥有任一声明权限的所需操作权限。
    const hasPermission = requiredPermissions.some((required) =>
      permissions.some(
        (permission) =>
          permission.module === required.module &&
          permission.menu === required.menu &&
          permission[required.action] === true
      )
    );

    if (!hasPermission) {
      throw new ForbiddenException(
        `无操作权限：${requiredPermissions
          .map((permission) => `${permission.module}/${permission.menu}/${permission.action}`)
          .join(' 或 ')}`
      );
    }

    return true;
  }
}
