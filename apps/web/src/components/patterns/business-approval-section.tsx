import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

import { ApprovalPanel } from './approval-panel';
import type { BusinessApprovalContext } from './business-approval-context';

const APPROVAL_VISIBLE_STATUSES = new Set(['pending', 'approved', 'rejected', 'withdrawn']);

interface BusinessApprovalSectionProps extends BusinessApprovalContext {
  eventType: string;
  formId?: string | null;
  flowStatus?: string | null;
  className?: string;
  children?: ReactNode;
  onSuccess?: () => void | Promise<void>;
}

export function BusinessApprovalSection({
  eventType,
  formId,
  flowStatus,
  approvalInstanceId,
  approvalEventType,
  onApprovalSuccess,
  className,
  children,
  onSuccess,
}: BusinessApprovalSectionProps) {
  const shouldShow =
    !!approvalInstanceId || (!!formId && !!flowStatus && APPROVAL_VISIBLE_STATUSES.has(flowStatus));

  if (!shouldShow) return null;

  return (
    <div className={cn('space-y-3', className)}>
      {children}
      <ApprovalPanel
        instanceId={approvalInstanceId}
        eventType={approvalEventType || eventType}
        formId={formId}
        onSuccess={async () => {
          await Promise.resolve(onSuccess?.());
          await Promise.resolve(onApprovalSuccess?.());
        }}
      />
    </div>
  );
}
