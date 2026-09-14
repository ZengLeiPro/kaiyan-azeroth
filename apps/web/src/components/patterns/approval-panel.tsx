import {
  APPROVAL_EVENT_TYPE,
  APPROVAL_EVENT_TYPE_LABELS,
  APPROVAL_INSTANCE_STATUS_LABELS,
} from '@ky-azeroth/shared/constants';
import type {
  IApprovalChangeRequestResponse,
  IApprovalInstanceResponse,
  IApprovalRecordResponse,
  IApprovalTaskResponse,
} from '@ky-azeroth/shared/types';
import { format } from 'date-fns';
import { ChevronDown, ChevronUp, Loader2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { api } from '@/lib/api';
import { computeApprovalPermissions } from '@/lib/approval-permissions';
import { logger } from '@/lib/logger';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/stores/auth';

import { ApprovalActions } from './ApprovalActions';
import { ApprovalTimeline } from './ApprovalTimeline';
import { EmployeeSelect } from './employee-select';

interface ApprovalPanelProps {
  instanceId?: string | null;
  eventType?: string | null;
  formId?: string | null;
  className?: string;
  onSuccess?: () => void | Promise<void>;
}

const CHANGE_APPROVAL_EVENTS = new Set<string>([
  APPROVAL_EVENT_TYPE.SALE_ORDER_CHANGE,
  APPROVAL_EVENT_TYPE.SALE_ORDER_VOID,
  APPROVAL_EVENT_TYPE.INVOICE_CHANGE,
  APPROVAL_EVENT_TYPE.PAYMENT_CHANGE,
  APPROVAL_EVENT_TYPE.PAYMENT_REFUND_CHANGE,
  APPROVAL_EVENT_TYPE.VISIT_CHANGE,
  APPROVAL_EVENT_TYPE.CUSTOMER_TAG_CHANGE,
]);

function getLeadStageReason(changeRequest: IApprovalChangeRequestResponse | null): string | null {
  if (!changeRequest || typeof changeRequest.patch !== 'object' || changeRequest.patch === null) {
    return null;
  }
  const patch = changeRequest.patch as Record<string, unknown>;
  const reason = patch.__reason;
  return typeof reason === 'string' && reason.trim().length > 0 ? reason.trim() : null;
}

function getLeadStageTarget(changeRequest: IApprovalChangeRequestResponse | null): string | null {
  if (!changeRequest || typeof changeRequest.patch !== 'object' || changeRequest.patch === null) {
    return null;
  }
  const patch = changeRequest.patch as Record<string, unknown>;
  return typeof patch.leadStage === 'string' ? patch.leadStage : null;
}

function getVoidReason(changeRequest: IApprovalChangeRequestResponse | null): string | null {
  if (!changeRequest || typeof changeRequest.patch !== 'object' || changeRequest.patch === null) {
    return null;
  }
  const patch = changeRequest.patch as Record<string, unknown>;
  if (patch.__operation !== 'void' && patch.__operation !== 'void_bundle') return null;
  const reason = patch.__reason;
  return typeof reason === 'string' && reason.trim().length > 0 ? reason.trim() : '未填写';
}

interface VoidDependencySummary {
  paymentCount: number;
  removableInvoiceCount: number;
  preservedInvoiceCount: number;
  projectName: string | null;
}

function getVoidDependencySummary(
  changeRequest: IApprovalChangeRequestResponse | null
): VoidDependencySummary | null {
  if (
    !changeRequest ||
    typeof changeRequest.afterSnapshot !== 'object' ||
    changeRequest.afterSnapshot === null
  ) {
    return null;
  }
  const dependencies = (changeRequest.afterSnapshot as Record<string, unknown>).voidDependencies;
  if (typeof dependencies !== 'object' || dependencies === null) return null;
  const record = dependencies as Record<string, unknown>;
  const payments =
    typeof record.payments === 'object' && record.payments !== null
      ? (record.payments as Record<string, unknown>)
      : {};
  const invoices =
    typeof record.invoices === 'object' && record.invoices !== null
      ? (record.invoices as Record<string, unknown>)
      : {};
  const project =
    typeof record.project === 'object' && record.project !== null
      ? (record.project as Record<string, unknown>)
      : null;
  return {
    paymentCount:
      numberFromUnknown(payments.approvedCount) + numberFromUnknown(payments.removableCount),
    removableInvoiceCount: numberFromUnknown(invoices.removableCount),
    preservedInvoiceCount: numberFromUnknown(invoices.preservedCount),
    projectName: typeof project?.name === 'string' ? project.name : null,
  };
}

function numberFromUnknown(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

const SALE_ORDER_CHANGE_FIELD_LABELS: Record<string, string> = {
  orderTitle: '订单名称',
  customerId: '客户',
  opportunityId: '关联商机',
  orderAmount: '合同金额',
  otherFee: '其他费用',
  businessDate: '业务日期',
  paymentDate: '预计回款日期',
  orderBeginDate: '合同开始日期',
  orderEndDate: '合同结束日期',
  chargerId: '负责人',
  remark: '备注',
  products: '产品明细',
};

interface ChangeDetail {
  field: string;
  before: string;
  after: string;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function formatChangeValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '未填写';
  if (Array.isArray(value)) return value.length === 0 ? '无' : `共 ${value.length} 项`;
  if (typeof value === 'object') {
    const record = asRecord(value);
    if (record && typeof record.name === 'string') return record.name;
    return JSON.stringify(value);
  }
  const text = String(value);
  return /^\d{4}-\d{2}-\d{2}T/.test(text) ? text.slice(0, 10) : text;
}

function formatProductValue(value: unknown): string {
  if (!Array.isArray(value)) return formatChangeValue(value);
  if (value.length === 0) return '无产品明细';

  return value
    .map((item, index) => {
      const product = asRecord(item);
      if (!product) return `第 ${index + 1} 项：${formatChangeValue(item)}`;
      const name = formatChangeValue(product.productName);
      const productNumber = product.productNumber ? `（${product.productNumber}）` : '';
      const details = [
        `数量 ${formatChangeValue(product.quantity)}`,
        `产品单价 ${formatChangeValue(product.productPrice)}`,
        `单价 ${formatChangeValue(product.unitPrice)}`,
        `合同单价 ${formatChangeValue(product.contractUnitPrice)}`,
      ];
      if (product.remark) details.push(`备注 ${formatChangeValue(product.remark)}`);
      return `第 ${index + 1} 项：${name}${productNumber}，${details.join('，')}`;
    })
    .join('；');
}

function formatSaleOrderChangeValue(field: string, value: unknown): string {
  return field === 'products' ? formatProductValue(value) : formatChangeValue(value);
}

export function getSaleOrderChangeDetails(
  changeRequest: IApprovalChangeRequestResponse | null
): ChangeDetail[] {
  if (!changeRequest || changeRequest.eventType !== APPROVAL_EVENT_TYPE.SALE_ORDER_CHANGE) {
    return [];
  }
  const patch = asRecord(changeRequest.patch);
  const beforeSnapshot = asRecord(changeRequest.beforeSnapshot);
  const afterSnapshot = asRecord(changeRequest.afterSnapshot);
  if (!patch || !beforeSnapshot || !afterSnapshot) return [];

  return Object.keys(patch)
    .filter((field) => !field.startsWith('__') && field !== 'version')
    .map((field) => ({
      field: SALE_ORDER_CHANGE_FIELD_LABELS[field] ?? field,
      before: formatSaleOrderChangeValue(field, beforeSnapshot[field]),
      after: formatSaleOrderChangeValue(field, afterSnapshot[field]),
    }))
    .filter((detail) => detail.before !== detail.after);
}

export function isSaleOrderChangeDetailMissing(
  eventType: string | null | undefined,
  details: ChangeDetail[]
): boolean {
  return eventType === APPROVAL_EVENT_TYPE.SALE_ORDER_CHANGE && details.length === 0;
}

export function getLatestApprovalInstanceId(
  changeRequest: IApprovalChangeRequestResponse | null
): string | null {
  const patch = changeRequest ? asRecord(changeRequest.patch) : null;
  return typeof patch?.__latestApprovalInstanceId === 'string'
    ? patch.__latestApprovalInstanceId
    : null;
}

function hasLatestApproval(changeRequest: IApprovalChangeRequestResponse | null): boolean {
  return getLatestApprovalInstanceId(changeRequest) !== null;
}

function getStatusVariant(
  status: string
): 'default' | 'secondary' | 'destructive' | 'outline' | 'success' | 'warning' | 'info' {
  switch (status) {
    case 'pending':
      return 'warning';
    case 'approved':
      return 'success';
    case 'rejected':
      return 'destructive';
    case 'withdrawn':
      return 'secondary';
    default:
      return 'secondary';
  }
}

export function ApprovalPanel({
  instanceId,
  eventType,
  formId,
  className,
  onSuccess,
}: ApprovalPanelProps) {
  const { user, getPermissions } = useAuthStore();
  const canAdminApprove = getPermissions().some(
    (permission) =>
      permission.module === 'approval' &&
      permission.menu === 'approval_list' &&
      permission.approve === true &&
      permission.viewScope === 'ALL'
  );
  const [loading, setLoading] = useState(false);
  const [activeInstanceId, setActiveInstanceId] = useState(instanceId);
  const [instance, setInstance] = useState<IApprovalInstanceResponse | null>(null);
  const [changeRequest, setChangeRequest] = useState<IApprovalChangeRequestResponse | null>(null);
  const [changeRequestLoadFailed, setChangeRequestLoadFailed] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  // CUSTOMER_TAG_CHANGE 终审时指定的承接销售；通过后客户负责人同步为该员工。
  // reload 或切换 instance 时会随 loadInstance 清空。
  const [chargerId, setChargerId] = useState('');

  useEffect(() => {
    setActiveInstanceId(instanceId);
  }, [instanceId]);

  const loadInstance = useCallback(async () => {
    if (!activeInstanceId && (!eventType || !formId)) {
      setInstance(null);
      setChangeRequest(null);
      setChangeRequestLoadFailed(false);
      setChargerId('');
      return;
    }

    setLoading(true);
    try {
      const res = activeInstanceId
        ? await api.get<IApprovalInstanceResponse>(`/approvals/${activeInstanceId}`)
        : await api.get<IApprovalInstanceResponse | null>(`/approvals/form/${eventType}/${formId}`);
      const nextInstance = res.data?.id ? res.data : null;
      setInstance(nextInstance);
      setChargerId('');

      if (
        nextInstance?.eventType &&
        CHANGE_APPROVAL_EVENTS.has(nextInstance.eventType) &&
        nextInstance.formId
      ) {
        try {
          const changeRes = await api.get<IApprovalChangeRequestResponse>(
            `/approvals/change-requests/${nextInstance.formId}`
          );
          setChangeRequest(changeRes.data);
          setChangeRequestLoadFailed(false);
        } catch (error) {
          // 审批实例已成功读取时，变更申请失败不能连带清空审批操作入口。
          logger.error('ApprovalPanel', '加载变更申请失败:', error);
          setChangeRequest(null);
          setChangeRequestLoadFailed(true);
        }
      } else {
        setChangeRequest(null);
        setChangeRequestLoadFailed(false);
      }
    } catch (error) {
      logger.error('ApprovalPanel', '加载审批信息失败:', error);
      setInstance(null);
      setChangeRequest(null);
      setChangeRequestLoadFailed(false);
      setChargerId('');
    } finally {
      setLoading(false);
    }
  }, [activeInstanceId, eventType, formId]);

  useEffect(() => {
    void loadInstance();
  }, [loadInstance]);

  const leadStageReason = getLeadStageReason(changeRequest);
  const leadStageTarget = getLeadStageTarget(changeRequest);
  const voidReason = getVoidReason(changeRequest);
  const voidDependencySummary = getVoidDependencySummary(changeRequest);
  const saleOrderChangeDetails = getSaleOrderChangeDetails(changeRequest);
  const supersededByLatestApproval = hasLatestApproval(changeRequest);
  const instanceStatus = instance?.status;
  useEffect(() => {
    if (instanceStatus) setCollapsed(instanceStatus !== 'pending');
  }, [instanceStatus]);

  const myIdForApproval = user?.employee?.id ?? user?.id;
  const { canApprove, canApproveAsNormal, canApproveAsAdmin, canWithdraw } =
    computeApprovalPermissions(instance, myIdForApproval, canAdminApprove, user?.id);

  // CUSTOMER_TAG_CHANGE 「指定承接销售」的可见条件：
  // - 事件类型匹配
  // - 当前用户能审批
  // - 当前节点是末节点（副作用只在末节点通过时才真正落地，见 approvals.service.updateBusinessStatus 注释）
  const isCustomerTagChange = instance?.eventType === APPROVAL_EVENT_TYPE.CUSTOMER_TAG_CHANGE;
  const isFinalNode = !!instance && instance.currentNode >= instance.totalNodes;
  const showChargerSlot = Boolean(isCustomerTagChange && canApprove && isFinalNode);
  const approveDisabled =
    (showChargerSlot && !chargerId) ||
    isSaleOrderChangeDetailMissing(instance?.eventType, saleOrderChangeDetails);

  const runApprovalAction = async (action: 'approve' | 'reject', comment?: string) => {
    if (!instance) return;
    // 弹出确认框后审批可能已被撤回、替换或处理；操作前重读实例，避免用页面旧快照盲提。
    const latest = await api.get<IApprovalInstanceResponse>(`/approvals/${instance.id}`);
    if (latest.data.status !== 'pending') {
      if (CHANGE_APPROVAL_EVENTS.has(latest.data.eventType) && latest.data.formId) {
        const changeRes = await api.get<IApprovalChangeRequestResponse>(
          `/approvals/change-requests/${latest.data.formId}`
        );
        const latestApprovalInstanceId = getLatestApprovalInstanceId(changeRes.data);
        if (latestApprovalInstanceId && latestApprovalInstanceId !== latest.data.id) {
          setActiveInstanceId(latestApprovalInstanceId);
          throw new Error('当前审批已失效，已加载最新审批');
        }
      }
      await loadInstance();
      throw new Error('审批状态已更新，已加载最新内容');
    }
    const endpoint =
      canApproveAsAdmin && !canApproveAsNormal
        ? `/approvals/${latest.data.id}/admin-approve`
        : `/approvals/${latest.data.id}/approve`;
    // 只在 approve + 已指定承接销售时带 sideEffects；reject 一律忽略（避免脏改客户）
    const sideEffects =
      action === 'approve' && showChargerSlot && chargerId ? { chargerId } : undefined;
    await api.post(endpoint, { action, comment, ...(sideEffects ? { sideEffects } : {}) });
    await loadInstance();
    await Promise.resolve(onSuccess?.());
  };

  const handleWithdraw = async (comment?: string) => {
    if (!instance) return;
    await api.post(`/approvals/${instance.id}/withdraw`, { comment });
    await loadInstance();
    await Promise.resolve(onSuccess?.());
  };

  if (loading) {
    return (
      <Card className={className}>
        <CardContent className="flex items-center justify-center py-8">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  if (!instance) return null;

  return (
    <Card className={cn('overflow-hidden', className)}>
      <CardHeader
        className={cn('cursor-pointer select-none bg-muted/20 pb-3', !collapsed && 'border-b')}
        onClick={() => setCollapsed((c) => !c)}
        role="button"
        tabIndex={0}
        aria-expanded={!collapsed}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setCollapsed((c) => !c);
          }
        }}
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <CardTitle className="text-base">审批信息</CardTitle>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
              <span>{instance.initiatorName} 发起</span>
              <span>{format(new Date(instance.createdAt), 'yyyy-MM-dd HH:mm')}</span>
              <span className="font-mono">{instance.code}</span>
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Badge variant={getStatusVariant(instance.status)}>
              {APPROVAL_INSTANCE_STATUS_LABELS[instance.status] || instance.status}
            </Badge>
            <Badge variant="outline">
              {APPROVAL_EVENT_TYPE_LABELS[instance.eventType] || instance.eventType}
            </Badge>
            {canApproveAsAdmin && !canApproveAsNormal && (
              <Badge variant="info" className="text-xs">
                管理员代审
              </Badge>
            )}
            {collapsed ? (
              <ChevronDown className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
            ) : (
              <ChevronUp className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
            )}
          </div>
        </div>
      </CardHeader>
      {!collapsed && (
        <CardContent className="space-y-5 pt-5">
          {supersededByLatestApproval && (
            <div className="rounded-lg border border-warning/40 bg-warning/10 p-4 text-sm">
              此审批已因销售重新提交订单变更而自动失效，已为最新变更创建新的审批入口。
            </div>
          )}

          {instance.eventType === APPROVAL_EVENT_TYPE.SALE_ORDER_CHANGE && (
            <div className="rounded-lg border bg-muted/20 p-4">
              <div className="mb-3 text-sm font-medium">本次订单变更</div>
              {saleOrderChangeDetails.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[560px] text-sm">
                    <thead className="border-b text-left text-muted-foreground">
                      <tr>
                        <th className="pb-2 pr-3 font-medium">修改字段</th>
                        <th className="pb-2 pr-3 font-medium">修改前</th>
                        <th className="pb-2 font-medium">修改后</th>
                      </tr>
                    </thead>
                    <tbody>
                      {saleOrderChangeDetails.map((detail) => (
                        <tr key={detail.field} className="border-b last:border-0">
                          <td className="py-2 pr-3 font-medium">{detail.field}</td>
                          <td className="py-2 pr-3 text-muted-foreground">{detail.before}</td>
                          <td className="py-2">{detail.after}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
                  <p>
                    {changeRequestLoadFailed
                      ? '变更明细加载失败，无法通过当前审批；你仍可驳回或重新加载。'
                      : '未读取到有效的订单变更明细，不能继续审批。'}
                  </p>
                  {changeRequestLoadFailed && (
                    <Button
                      className="mt-3"
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => void loadInstance()}
                    >
                      重新加载变更明细
                    </Button>
                  )}
                </div>
              )}
            </div>
          )}

          {voidReason && (
            <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4">
              <div className="mb-2 text-sm font-medium text-destructive">作废申请</div>
              <div className="text-sm">
                <div className="mb-1 text-muted-foreground">作废原因：</div>
                <pre className="max-h-72 overflow-y-auto whitespace-pre-wrap rounded-md bg-background p-3 text-sm leading-relaxed">
                  {voidReason}
                </pre>
                {voidDependencySummary && (
                  <div className="mt-3 rounded-md bg-background p-3">
                    <div className="mb-1 font-medium">审批通过后将原子处理：</div>
                    <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
                      <li>作废或删除回款/退款 {voidDependencySummary.paymentCount} 笔</li>
                      <li>
                        删除无正式票号的草稿/驳回发票 {voidDependencySummary.removableInvoiceCount}{' '}
                        笔
                      </li>
                      <li>
                        保留已作废/已冲红发票 {voidDependencySummary.preservedInvoiceCount} 笔
                      </li>
                      {voidDependencySummary.projectName && (
                        <li>
                          解除项目「{voidDependencySummary.projectName}」的订单绑定并回退到商机中
                        </li>
                      )}
                    </ul>
                  </div>
                )}
              </div>
            </div>
          )}

          {instance.eventType === APPROVAL_EVENT_TYPE.CUSTOMER_TAG_CHANGE &&
            (leadStageTarget || leadStageReason) && (
              <div className="rounded-lg border bg-muted/20 p-4">
                <div className="mb-2 text-sm font-medium">线索阶段提交信息</div>
                <div className="space-y-2 text-sm">
                  {leadStageTarget && (
                    <div>
                      <span className="text-muted-foreground">目标阶段：</span>
                      <span className="font-medium">{leadStageTarget}</span>
                    </div>
                  )}
                  {leadStageReason && (
                    <div>
                      <div className="mb-1 text-muted-foreground">提交备注：</div>
                      <pre className="max-h-72 overflow-y-auto whitespace-pre-wrap rounded-md bg-background p-3 text-sm leading-relaxed">
                        {leadStageReason}
                      </pre>
                    </div>
                  )}
                </div>
              </div>
            )}

          <ApprovalTimeline
            records={(instance.records || []) as IApprovalRecordResponse[]}
            tasks={(instance.tasks || []) as IApprovalTaskResponse[]}
            currentNode={instance.currentNode}
            totalNodes={instance.totalNodes}
            instanceStatus={instance.status}
          />

          {(canApprove || canWithdraw) && (
            <div className="border-t pt-4">
              <ApprovalActions
                instanceId={instance.id}
                canApprove={canApprove}
                canWithdraw={canWithdraw}
                onApprove={(comment) => runApprovalAction('approve', comment)}
                onReject={(comment) => runApprovalAction('reject', comment)}
                onWithdraw={handleWithdraw}
                approveDisabled={approveDisabled}
                extraApproveContent={
                  showChargerSlot ? (
                    <div className="space-y-1.5">
                      <Label className="text-sm">指定承接销售（必选）</Label>
                      <EmployeeSelect
                        value={chargerId}
                        onChange={setChargerId}
                        placeholder="选择承接销售"
                      />
                      <p className="text-xs text-muted-foreground">
                        通过后客户负责人更新为指定销售，并自动将发起本次审批的电销加入协作人；驳回时不落地。
                      </p>
                    </div>
                  ) : null
                }
              />
            </div>
          )}
        </CardContent>
      )}
    </Card>
  );
}
