import { Flag, Play } from 'lucide-react';

import type { ApprovalFlowNodeFormData } from '../types';
import { AddNodeButton, type NodeType } from './AddNodeButton';
import { ApprovalNodeCard } from './ApprovalNodeCard';
import { CcNodeCard } from './CcNodeCard';
import { NodeCard } from './NodeCard';

interface FlowCanvasProps {
  nodes: ApprovalFlowNodeFormData[];
  selectedIndex: number | null;
  onNodeSelect: (index: number) => void;
  onNodeDelete: (index: number) => void;
  onAddNode: (afterIndex: number, nodeType: NodeType) => void;
}

export function FlowCanvas({
  nodes,
  selectedIndex,
  onNodeSelect,
  onNodeDelete,
  onAddNode,
}: FlowCanvasProps) {
  // Count approval nodes (at least 1 approval node required)
  const approvalNodeCount = nodes.filter((n) => n.nodeType === 'approval').length;

  return (
    <div className="flex h-full justify-center overflow-auto bg-muted/30 px-4 py-8">
      <div className="inline-flex flex-col items-center">
        {/* Start Node */}
        <NodeCard title="开始" icon={<Play className="h-4 w-4" />} color="green" />

        {/* Add node after start */}
        {nodes.length === 0 && <AddNodeButton onAdd={(type) => onAddNode(-1, type)} />}

        {/* Nodes */}
        {nodes.map((node, index) => (
          <div key={index} className="flex flex-col items-center">
            {/* Connector line */}
            <div className="h-4 w-px bg-border" />

            {node.nodeType === 'cc' ? (
              <CcNodeCard
                node={node}
                selected={selectedIndex === index}
                onClick={() => onNodeSelect(index)}
                onDelete={() => onNodeDelete(index)}
                canDelete={true}
              />
            ) : (
              <ApprovalNodeCard
                node={node}
                selected={selectedIndex === index}
                onClick={() => onNodeSelect(index)}
                onDelete={() => onNodeDelete(index)}
                canDelete={approvalNodeCount > 1}
              />
            )}

            {/* Add node button after each node */}
            <AddNodeButton onAdd={(type) => onAddNode(index, type)} />
          </div>
        ))}

        {/* End Node */}
        <div className="h-4 w-px bg-border" />
        <NodeCard title="结束" icon={<Flag className="h-4 w-4" />} color="gray" />
      </div>
    </div>
  );
}
