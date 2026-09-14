import { APPROVER_TYPE } from '@ky-azeroth/shared/constants';
import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../common/prisma/prisma.service';
import { ACTIVE_EMPLOYEE_WHERE } from '../employees/employees.helper';

interface ResolvedApprover {
  approverId: string;
  approverName: string;
  approverType: string;
  sequence: number;
}

/**
 * push 6: user 表已删除，所有审批人 ID 统一以 employee.id 为准。
 * 历史 approverUserIds / initiatorUserId 入参语义改为 employee.id。
 */
@Injectable()
export class ApproverResolverService {
  constructor(private prisma: PrismaService) {}

  async resolveApprovers(
    node: {
      approverType: string;
      approverUserIds: string[];
      approverRoleId?: string | null;
      managerLevel: number;
      multiType: string;
    },
    initiatorUserId: string
  ): Promise<ResolvedApprover[]> {
    const approvers: ResolvedApprover[] = [];

    switch (node.approverType) {
      case APPROVER_TYPE.MEMBER:
        // 指定人员：approverUserIds 现存储 employee.id
        if (node.approverUserIds.length > 0) {
          const employees = await this.prisma.employee.findMany({
            where: {
              id: { in: node.approverUserIds },
              deletedAt: null,
            },
            select: { id: true, name: true, username: true },
          });

          employees.forEach((emp, index) => {
            approvers.push({
              approverId: emp.id,
              approverName: emp.name || emp.username || 'unknown',
              approverType: APPROVER_TYPE.MEMBER,
              sequence: node.multiType === 'sequence' ? index + 1 : 0,
            });
          });
        }
        break;

      case APPROVER_TYPE.MANAGER: {
        // 直属主管：发起人主部门负责人
        const initiator = await this.prisma.employee.findUnique({
          where: { id: initiatorUserId },
          include: {
            departments: {
              where: { isPrimary: true },
              include: {
                department: {
                  include: {
                    manager: { select: { id: true, name: true } },
                  },
                },
              },
              take: 1,
            },
          },
        });

        const primaryDept = initiator?.departments?.[0]?.department;
        // 注意：manager == initiator（自己是部门负责人）时也照常加入 approvers。
        // 由审批引擎的「申请人=审批人自动通过」层统一处理（approvals.service.ts
        // 的 autoPassSelfTasksAndAdvance），保持 MANAGER/MEMBER/ROLE 三种类型行为一致。
        // 仅在 manager 不存在（部门未设负责人）时 fail-fast 让 submit 阶段抛
        // "节点无有效审批人"，以暴露真正的配置错误。
        if (primaryDept?.manager) {
          approvers.push({
            approverId: primaryDept.manager.id,
            approverName: primaryDept.manager.name,
            approverType: APPROVER_TYPE.MANAGER,
            sequence: 0,
          });
        }
        break;
      }

      case APPROVER_TYPE.ROLE:
        // 指定角色：拥有该角色的所有员工（push 6: user_roles 主键 (employeeId, roleId)）
        if (node.approverRoleId) {
          const userRoles = await this.prisma.userRole.findMany({
            where: {
              roleId: node.approverRoleId,
              employee: ACTIVE_EMPLOYEE_WHERE,
            },
            include: {
              employee: { select: { id: true, name: true, username: true } },
            },
          });

          userRoles.forEach((userRole, index) => {
            approvers.push({
              approverId: userRole.employeeId,
              approverName: userRole.employee?.name || userRole.employee?.username || 'unknown',
              approverType: APPROVER_TYPE.ROLE,
              sequence: node.multiType === 'sequence' ? index + 1 : 0,
            });
          });
        }
        break;
    }

    return approvers;
  }

  async validateNodeConfig(
    node: {
      approverType: string;
      approverUserIds: string[];
      approverRoleId?: string | null;
      managerLevel: number;
      multiType: string;
    },
    initiatorUserId: string
  ): Promise<boolean> {
    const approvers = await this.resolveApprovers(node, initiatorUserId);
    return approvers.length > 0;
  }

  /**
   * 根据 employeeId 获取员工信息（用于审批快照）
   */
  async getUserInfo(userId: string): Promise<{ name: string } | null> {
    const employee = await this.prisma.employee.findUnique({
      where: { id: userId },
      select: { name: true, username: true },
    });

    if (!employee) return null;

    return { name: employee.name || employee.username || 'unknown' };
  }
}
