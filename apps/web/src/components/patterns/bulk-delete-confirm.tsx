import { ResponsiveDialog } from '@/components/mobile/ResponsiveDialog';
import { Button } from '@/components/ui/button';

export interface BulkDeleteConfirmProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedCount: number;
  onConfirm: () => unknown;
  loading?: boolean;
}

export function BulkDeleteConfirm({
  open,
  onOpenChange,
  selectedCount,
  onConfirm,
  loading,
}: BulkDeleteConfirmProps) {
  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={onOpenChange}
      title="确认批量删除"
      desktopMaxWidth="max-w-sm"
      modal
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button variant="destructive" onClick={onConfirm} disabled={loading}>
            {loading ? '删除中...' : '确认删除'}
          </Button>
        </>
      }
    >
      <p className="py-4 text-muted-foreground">
        确定要删除已选中的 <span className="font-medium text-foreground">{selectedCount}</span>{' '}
        项数据吗？
        <br />
        此操作不可撤销。
      </p>
    </ResponsiveDialog>
  );
}
