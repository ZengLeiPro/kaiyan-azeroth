import { ClipboardCheck } from 'lucide-react';

import { Button } from '@/components/ui/button';

interface ApplyPlanButtonProps {
  onClick: () => void;
  disabled?: boolean;
}

export function ApplyPlanButton({ onClick, disabled }: ApplyPlanButtonProps) {
  return (
    <Button variant="outline" size="sm" onClick={onClick} disabled={disabled}>
      <ClipboardCheck className="mr-1.5 h-3.5 w-3.5" />
      应用昨日计划
    </Button>
  );
}
