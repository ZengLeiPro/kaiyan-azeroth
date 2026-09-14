import { Pencil, Trash2 } from 'lucide-react';
import { ReactNode } from 'react';

import { ResponsiveDialog } from '@/components/mobile/ResponsiveDialog';
import { Button } from '@/components/ui/button';
import { useIsMobile } from '@/hooks/use-mobile';
import { cn } from '@/lib/utils';

import { ChangeLogPanel, type ChangeLogTarget } from './change-log-panel';
import { FormModeProvider } from './form-field';

export interface FormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  mode: 'view' | 'edit' | 'create';
  onModeChange?: () => void;
  children: ReactNode;
  onSubmit?: () => unknown;
  onDelete?: () => unknown;
  loading?: boolean;
  maxWidth?: string;
  footer?: ReactNode;
  viewHeaderActions?: ReactNode;
  changeLogTarget?: ChangeLogTarget;
  // 变体：dialog(居中弹窗) | drawer(右侧抽屉)
  variant?: 'dialog' | 'drawer';
}

export function FormDialog({
  open,
  onOpenChange,
  title,
  description,
  mode,
  onModeChange,
  children,
  onSubmit,
  onDelete,
  loading,
  maxWidth = 'max-w-[920px]',
  footer: customFooter,
  viewHeaderActions,
  changeLogTarget,
  variant,
}: FormDialogProps) {
  const isMobile = useIsMobile();
  const handleClose = () => onOpenChange(false);

  const displayTitle =
    mode === 'create' ? title : mode === 'view' ? title : `编辑${title.replace(/详情$/, '')}`;

  // 操作按钮：桌面端放在顶栏标题右侧，移动端放在底部 sticky footer（避免键盘遮挡）
  const buttonRowClass = cn('flex items-center gap-2', isMobile && 'w-full justify-end');

  let actionButtons: ReactNode;
  if (customFooter) {
    // 自定义 footer 接管底部，标准按钮不渲染
    actionButtons = undefined;
  } else if (mode === 'view') {
    actionButtons = (
      <div className={buttonRowClass}>
        {viewHeaderActions}
        {onDelete && (
          <Button type="button" variant="destructive" size="sm" onClick={onDelete}>
            <Trash2 className="mr-1 h-3.5 w-3.5" />
            删除
          </Button>
        )}
        {onModeChange && (
          <Button type="button" size="sm" onClick={onModeChange}>
            <Pencil className="mr-1 h-3.5 w-3.5" />
            编辑
          </Button>
        )}
        <Button type="button" variant="outline" size="sm" onClick={handleClose}>
          关闭
        </Button>
      </div>
    );
  } else {
    actionButtons = (
      <div className={buttonRowClass}>
        {mode === 'edit' && onDelete && (
          <Button type="button" variant="destructive" size="sm" onClick={onDelete}>
            <Trash2 className="mr-1 h-3.5 w-3.5" />
            删除
          </Button>
        )}
        <Button type="button" variant="outline" size="sm" onClick={handleClose}>
          取消
        </Button>
        <Button type="button" size="sm" onClick={onSubmit} disabled={loading}>
          {loading ? '处理中...' : mode === 'create' ? '创建' : '保存'}
        </Button>
      </div>
    );
  }

  // 移动端按钮放底部 footer，桌面端放顶栏 headerAction
  const headerAction = !isMobile ? actionButtons : undefined;
  const footer = customFooter ?? (isMobile ? actionButtons : undefined);

  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={onOpenChange}
      title={displayTitle}
      description={description}
      desktopMaxWidth={maxWidth}
      footer={footer}
      headerAction={headerAction}
      variant={variant}
      hideCloseButton={!customFooter}
    >
      <FormModeProvider mode={mode}>
        <div className={cn(isMobile ? 'space-y-4' : 'grid grid-cols-2 gap-x-4 gap-y-4')}>
          {children}
        </div>
      </FormModeProvider>
      {mode === 'view' ? <ChangeLogPanel target={changeLogTarget} /> : null}
    </ResponsiveDialog>
  );
}
