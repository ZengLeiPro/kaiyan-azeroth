import { Users } from 'lucide-react';

import type { ApprovalFlowNodeFormData } from '../types';
import { NodeCard } from './NodeCard';

interface CcNodeCardProps {
  node: ApprovalFlowNodeFormData;
  selected?: boolean;
  onClick?: () => void;
  onDelete?: () => void;
  canDelete?: boolean;
}

export function CcNodeCard({
  node,
  selected = false,
  onClick,
  onDelete,
  canDelete = true,
}: CcNodeCardProps) {
  // Get cc info description
  const getCcInfo = (): string => {
    const count = node.ccUserIds?.length || 0;
    return count > 0 ? `${count} 人` : '未选择抄送人';
  };

  return (
    <NodeCard
      title={node.nodeName || '抄送'}
      subtitle={getCcInfo()}
      icon={<Users className="h-4 w-4" />}
      color="orange"
      selected={selected}
      deletable={canDelete}
      onClick={onClick}
      onDelete={onDelete}
    />
  );
}
