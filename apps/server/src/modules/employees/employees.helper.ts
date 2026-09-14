import type { Prisma } from '@prisma/client';

/**
 * 在职员工口径（口径统一 helper，ORG-01）。
 *
 * 真实在职 = 可登录的 active 员工。Employee.status 'active' 在数据库里有 39 行，
 * 其中混入 25 个非员工节点（虚拟小号 / 合作伙伴 / 客户 / 招聘助理），它们
 * canLogin=false。仅 status='active' 不够，必须 +canLogin=true 才剔除这 25 个，
 * 让 analytics、工时填报员、转交目标员工存在性校验等下游口径一致（约 11 人）。
 *
 * 直接用作 Prisma where：
 *   prisma.employee.count({ where: ACTIVE_EMPLOYEE_WHERE })
 * 与其他 where 合并：
 *   prisma.employee.findMany({ where: { ...ACTIVE_EMPLOYEE_WHERE, dingtalkUserId: ... } })
 */
export const ACTIVE_EMPLOYEE_WHERE: Prisma.EmployeeWhereInput = {
  deletedAt: null,
  status: 'active',
  canLogin: true,
};
