import {
  APPROVER_TYPE,
  APPROVER_TYPE_LABELS,
  MULTI_APPROVAL_TYPE_LABELS,
} from '@ky-azeroth/shared/constants';
import { UserCheck } from 'lucide-react';

import type { ApprovalFlowNodeFormData } from '../types';
import { NodeCard } from './NodeCard';

interface ApprovalNodeCardProps {
  node: ApprovalFlowNodeFormData;
  selected?: boolean;
  onClick?: () => void;
  onDelete?: () => void;
  canDelete?: boolean;
}

export function ApprovalNodeCard({
  node,
  selected = false,
  onClick,
  onDelete,
  canDelete = true,
}: ApprovalNodeCardProps) {
  // Get approver info description
  const getApproverInfo = (): string => {
    switch (node.approverType) {
      case APPROVER_TYPE.MEMBER: {
        const count = node.approverUserIds?.length || 0;
        return count > 0 ? `指定成员 ${count} 人` : '未选择成员';
      }
      case APPROVER_TYPE.MANAGER:
        return `${node.managerLevel || 1} 级上级`;
      case APPROVER_TYPE.ROLE:
        return node.approverRoleId ? '指定角色' : '未选择角色';
      default:
        return APPROVER_TYPE_LABELS[node.approverType] || '未知';
    }
  };

  // Get multi-approval type description
  const getMultiApprovalInfo = (): string => {
    return MULTI_APPROVAL_TYPE_LABELS[node.multiType] || node.multiType;
  };

  const subtitle = [getApproverInfo(), getMultiApprovalInfo()].filter(Boolean).join(' / ');

  return (
    <NodeCard
      title={node.nodeName || '审批节点'}
      subtitle={subtitle}
      icon={<UserCheck className="h-4 w-4" />}
      color="blue"
      selected={selected}
      deletable={canDelete}
      onClick={onClick}
      onDelete={onDelete}
    />
  );
}
