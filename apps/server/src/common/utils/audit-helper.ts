/**
 * 审计字段统一生成
 *
 * Push 5 起：service 改单写 creator/updaterEmployeeId（不再写 createdBy/updatedBy）。
 * 旧 createdBy/updatedBy 列在 push 6 移除。Push 5 期间这些列保留但停止写入（值为 NULL）。
 *
 * 用法：
 *   await prisma.customer.create({ data: { ...input, ...auditCreate(user) } });
 *   await prisma.customer.update({ where: { id }, data: { ...input, ...auditUpdate(user) } });
 */

export interface AuditCreateFields {
  creatorEmployeeId: string | null;
  updaterEmployeeId: string | null;
}

export interface AuditUpdateFields {
  updaterEmployeeId: string | null;
}

/**
 * 创建场景的审计字段。push 4 起 user.id = employee.id，所以 user.employeeId 通常等于 user.id；
 * 旧链路传 user 对象不带 employeeId 字段时，回退用 user.id。
 */
export function auditCreate(
  user: { id: string; employeeId?: string | null } | null | undefined
): AuditCreateFields {
  const employeeId = user?.employeeId ?? user?.id ?? null;
  return {
    creatorEmployeeId: employeeId,
    updaterEmployeeId: employeeId,
  };
}

/**
 * 更新场景的审计字段：仅更新 updaterEmployeeId。
 */
export function auditUpdate(
  user: { id: string; employeeId?: string | null } | null | undefined
): AuditUpdateFields {
  const employeeId = user?.employeeId ?? user?.id ?? null;
  return {
    updaterEmployeeId: employeeId,
  };
}

/**
 * 仅有 updatedBy 没有 createdBy 的表（filter_schemes）专用。
 */
export function auditUpdateOnly(
  user: { id: string; employeeId?: string | null } | null | undefined
): AuditUpdateFields {
  return auditUpdate(user);
}

/**
 * 仅有 createdBy 没有 updatedBy 的表（employee_departments / project_sale_orders / personal_access_tokens）专用。
 */
export function auditCreateOnly(
  user: { id: string; employeeId?: string | null } | null | undefined
): { creatorEmployeeId: string | null } {
  const employeeId = user?.employeeId ?? user?.id ?? null;
  return {
    creatorEmployeeId: employeeId,
  };
}
