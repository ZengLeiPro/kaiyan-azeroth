import type { IApprovalInstanceResponse } from '@ky-azeroth/shared/types';

export interface ApprovalPermissions {
  canApproveAsNormal: boolean;
  canApproveAsAdmin: boolean;
  canApprove: boolean;
  canWithdraw: boolean;
}

const EMPTY: ApprovalPermissions = {
  canApproveAsNormal: false,
  canApproveAsAdmin: false,
  canApprove: false,
  canWithdraw: false,
};

export function computeApprovalPermissions(
  instance: IApprovalInstanceResponse | null | undefined,
  myEmployeeId: string | undefined,
  canAdminApprove: boolean,
  myUserId?: string
): ApprovalPermissions {
  if (!instance || instance.status !== 'pending') {
    return EMPTY;
  }

  const myIds = new Set([myEmployeeId, myUserId].filter((id): id is string => !!id));

  const canApproveAsNormal = !!instance.tasks?.some(
    (t) => myIds.has(t.approverId) && t.status === 'pending' && t.nodeOrder === instance.currentNode
  );

  const canApproveAsAdmin = canAdminApprove && !canApproveAsNormal;
  const canApprove = canApproveAsNormal || canApproveAsAdmin;

  const canWithdraw = myIds.has(instance.initiatorId);

  return { canApproveAsNormal, canApproveAsAdmin, canApprove, canWithdraw };
}

/** 审批中或已通过的业务单据不可直接删除。 */
export function canDeleteApprovalBusiness(flowStatus: string | null | undefined): boolean {
  return flowStatus !== 'pending' && flowStatus !== 'approved';
}
