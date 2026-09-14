import { Plus, UserCheck, Users } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

export type NodeType = 'approval' | 'cc';

interface AddNodeButtonProps {
  onAdd: (type: NodeType) => void;
}

export function AddNodeButton({ onAdd }: AddNodeButtonProps) {
  return (
    <div className="flex flex-col items-center">
      {/* Top line */}
      <div className="h-4 w-px bg-border" />

      {/* Add button with dropdown */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            size="icon"
            className="h-7 w-7 rounded-full border-dashed hover:border-primary hover:text-primary"
            onClick={(e) => e.stopPropagation()}
          >
            <Plus className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="center">
          <DropdownMenuItem onClick={() => onAdd('approval')}>
            <UserCheck className="mr-2 h-4 w-4 text-primary" />
            审批节点
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => onAdd('cc')}>
            <Users className="mr-2 h-4 w-4 text-orange-500" />
            抄送节点
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Bottom line */}
      <div className="h-4 w-px bg-border" />
    </div>
  );
}
