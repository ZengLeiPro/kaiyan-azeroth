import { Copy } from 'lucide-react';

import { Button } from '@/components/ui/button';

interface CopyYesterdayButtonProps {
  onClick: () => void;
}

export function CopyYesterdayButton({ onClick }: CopyYesterdayButtonProps) {
  return (
    <Button variant="outline" size="sm" onClick={onClick}>
      <Copy className="mr-1.5 h-3.5 w-3.5" />
      复制昨天
    </Button>
  );
}
