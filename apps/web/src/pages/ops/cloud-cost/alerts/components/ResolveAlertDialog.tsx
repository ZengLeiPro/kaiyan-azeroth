import { useEffect, useState } from 'react';

import { ResponsiveDialog } from '@/components/mobile/ResponsiveDialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

interface ResolveAlertDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  action: 'resolve' | 'dismiss';
  loading?: boolean;
  onConfirm: (note: string | null) => void | Promise<void>;
}

export function ResolveAlertDialog({
  open,
  onOpenChange,
  action,
  loading,
  onConfirm,
}: ResolveAlertDialogProps) {
  const [note, setNote] = useState('');

  useEffect(() => {
    if (!open) {
      setNote('');
    }
  }, [open]);

  const title = action === 'resolve' ? '处理预警' : '忽略预警';
  const submitLabel = action === 'resolve' ? '标记为已处理' : '标记为已忽略';

  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      desktopMaxWidth="max-w-[480px]"
      footer={
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
            取消
          </Button>
          <Button onClick={() => void onConfirm(note.trim() || null)} disabled={loading}>
            {loading ? '处理中...' : submitLabel}
          </Button>
        </div>
      }
    >
      <div className="space-y-3 py-2">
        <Label htmlFor="resolutionNote">备注（可选，最多 2000 字）</Label>
        <Textarea
          id="resolutionNote"
          value={note}
          rows={4}
          maxLength={2000}
          placeholder={
            action === 'resolve' ? '描述处理动作，便于后续审计' : '说明忽略原因（如误报）'
          }
          onChange={(e) => setNote(e.target.value)}
        />
      </div>
    </ResponsiveDialog>
  );
}
