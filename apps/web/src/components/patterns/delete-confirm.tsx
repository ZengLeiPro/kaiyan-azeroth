import { ResponsiveDialog } from '@/components/mobile/ResponsiveDialog';
import { Button } from '@/components/ui/button';

export interface DeleteConfirmProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  entityName: string;
  onConfirm: () => unknown;
  loading?: boolean;
  message?: string;
}

export function DeleteConfirm({
  open,
  onOpenChange,
  entityName,
  onConfirm,
  loading,
  message,
}: DeleteConfirmProps) {
  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={onOpenChange}
      title="确认删除"
      desktopMaxWidth="max-w-sm"
      modal
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button variant="destructive" onClick={onConfirm} disabled={loading}>
            {loading ? '删除中...' : '删除'}
          </Button>
        </>
      }
    >
      <p className="py-4 text-muted-foreground">
        {message || (
          <>
            确定要删除 <span className="font-medium text-foreground">{entityName}</span> 吗？
            此操作不可撤销。
          </>
        )}
      </p>
    </ResponsiveDialog>
  );
}
