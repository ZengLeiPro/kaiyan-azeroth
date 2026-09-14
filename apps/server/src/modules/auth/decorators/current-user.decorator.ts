import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export interface CurrentUserType {
  /** push 6: id = employee.id（user 表已删除，所有身份统一以 employee 为准） */
  id: string;
  username: string;
  roles: string[];
  /** 与 id 相同，仅作为业务代码 `currentUser.employeeId` 写法的兼容 alias */
  employeeId?: string;
  dingtalkUserId?: string;
  /** JWT 的 jti，即当前 Session.id；PAT 身份无此字段。 */
  sessionId?: string;
  /** 鉴权来源：jwt（默认登录）/ pat（长期访问令牌） */
  authType?: 'jwt' | 'pat';
  /** JWT payload.iat 对应的认证时间；PAT 身份无此字段。 */
  authenticatedAt?: Date;
  /** 当 authType=pat 时，指向 personal_access_tokens.id */
  patId?: string;
}

export const CurrentUser = createParamDecorator(
  (data: keyof CurrentUserType | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    const user = request.user as CurrentUserType;

    return data ? user?.[data] : user;
  }
);
