export interface BusinessApprovalContext {
  approvalInstanceId?: string | null;
  approvalEventType?: string | null;
  onApprovalSuccess?: () => void | Promise<void>;
}

export function normalizeBusinessApprovalContext(
  context?: Record<string, unknown>
): BusinessApprovalContext | undefined {
  if (!context) return undefined;
  const onApprovalSuccess = context.onApprovalSuccess;
  return {
    approvalInstanceId:
      typeof context.approvalInstanceId === 'string' ? context.approvalInstanceId : null,
    approvalEventType:
      typeof context.approvalEventType === 'string' ? context.approvalEventType : null,
    onApprovalSuccess:
      typeof onApprovalSuccess === 'function'
        ? (onApprovalSuccess as () => void | Promise<void>)
        : undefined,
  };
}
