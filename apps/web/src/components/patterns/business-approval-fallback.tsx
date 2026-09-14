import type { BusinessApprovalContext } from '@/components/patterns/business-approval-context';
import { Button } from '@/components/ui/button';

import { BusinessApprovalSection } from './business-approval-section';

interface BusinessApprovalFallbackProps {
  approvalContext?: BusinessApprovalContext;
  defaultEventType: string;
  formId: string;
  onRetry: () => void;
}

/**
 * 审批人可能没有业务单的数据访问权限，或业务单已经不存在。
 * 此时保留审批面板，避免业务单详情加载失败连带阻断审批操作。
 */
export function BusinessApprovalFallback({
  approvalContext,
  defaultEventType,
  formId,
  onRetry,
}: BusinessApprovalFallbackProps) {
  if (!approvalContext?.approvalInstanceId) return null;

  return (
    <div className="space-y-4">
      <BusinessApprovalSection
        eventType={approvalContext.approvalEventType ?? defaultEventType}
        formId={formId}
        approvalInstanceId={approvalContext.approvalInstanceId}
        approvalEventType={approvalContext.approvalEventType}
        onApprovalSuccess={approvalContext.onApprovalSuccess}
        onSuccess={onRetry}
      />
      <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
        <p>业务单加载失败，但你仍可查看并处理当前审批。</p>
        <Button className="mt-3" type="button" variant="outline" size="sm" onClick={onRetry}>
          重试加载业务单
        </Button>
      </div>
    </div>
  );
}
