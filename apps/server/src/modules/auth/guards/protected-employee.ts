import { ForbiddenException } from '@nestjs/common';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** 从环境读取受保护员工 UUID（保护锁，不授予额外权限）；缺失或格式错误时返回 null。 */
export function getProtectedEmployeeId(): string | null {
  const employeeId = process.env.SUPER_ADMIN_EMPLOYEE_ID?.trim();
  return employeeId && UUID_PATTERN.test(employeeId) ? employeeId : null;
}

/** 通用账号管理与 PAT 签发使用的 fail-closed 保护。 */
export function assertEmployeeIsNotProtected(employeeId: string): void {
  const protectedEmployeeId = getProtectedEmployeeId();
  if (!protectedEmployeeId) {
    throw new ForbiddenException('SUPER_ADMIN_EMPLOYEE_ID 未配置或不是有效 UUID，敏感操作已拒绝');
  }
  if (employeeId === protectedEmployeeId) {
    // 保护锁：不授予额外权限，只阻止删除/停用/改名/改角色。
    throw new ForbiddenException('受保护账号不允许通过通用管理接口变更');
  }
}

/** admin 是受保护账号的保留用户名，不能分配给其它账号。 */
export function assertUsernameIsNotReserved(username: string | null | undefined): void {
  if (username?.trim().toLowerCase() === 'admin') {
    throw new ForbiddenException('admin 是受保护账号的保留用户名');
  }
}
