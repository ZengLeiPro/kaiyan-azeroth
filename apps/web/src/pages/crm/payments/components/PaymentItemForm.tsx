import { PAYMENT_MODE, PAYMENT_MODE_VALUES_SALES } from '@ky-azeroth/shared/constants';
import type { ISaleOrderResponse } from '@ky-azeroth/shared/types/sale-order';
import { Plus, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

import { useFormMode } from '@/components/patterns/form-field';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { api } from '@/lib/api';

import {
  createEmptyPaymentItemRow,
  createPaymentItemRowsFromSaleOrderProducts,
  type PaymentItemFormRow,
} from '../types';

/**
 * 销售下单 PaymentItem 录入子表单（v2.2 任务 ③ PR-B）
 *
 * 把回款金额按产品拆成 N 行子项 → 提交时随 payment 一起单事务入库。
 *
 * 数据流：
 *  - props.saleOrderId 变化 → 拉 GET /sale-orders/:id 取 products 列表作下拉
 *  - props.value 是当前 items 数组，props.onChange 把新数组冒泡给父表单
 *  - 实时算 Σ items.amount 并与 props.paymentAmount 对比
 *    - 误差 ≥ 0.01 → 红色提示（提交时后端会再校验一次）
 *    - 全等 → 绿色"已对齐"提示
 *
 * 只读（FormMode view）：不发订单产品请求、渲染持久化快照文本、无任何编辑控件，
 * 历史 items 为空时显示"未记录产品拆分明细"空态。
 *
 * 可选模式：仅展示 direct / dingtalk_collect / pass_through 三种
 * （pass_through_cost 是 admin 调账专用，前端不展示）。
 */
interface PaymentItemFormProps {
  saleOrderId: string | null | undefined;
  /** null/undefined 视为「尚未录入」归一化为空数组；非数组对象视为数据契约异常。 */
  value?: PaymentItemFormRow[] | null;
  paymentAmount: number;
  onChange: (rows: PaymentItemFormRow[]) => void;
  disabled?: boolean;
  error?: string;
  /** 仅新建回款：合同变更时重置并自动带入其产品行。view 模式下始终不生效。 */
  autoPopulate?: boolean;
}

interface OrderProductOption {
  id: string;
  productName: string;
  subtotalAmount: string | null;
}

const PAYMENT_MODE_OPTIONS = PAYMENT_MODE_VALUES_SALES.map((v) => ({
  value: v,
  label: paymentModeLabel(v),
}));

function paymentModeLabel(mode: string): string {
  switch (mode) {
    case PAYMENT_MODE.DIRECT:
      return '直收（招商/兴业账户）';
    case PAYMENT_MODE.DINGTALK_COLLECT:
      return '钉钉代收（不进账户）';
    case PAYMENT_MODE.PASS_THROUGH:
      return '过单实收（净额）';
    default:
      return mode;
  }
}

const EMPTY_PAYMENT_ITEM_ROWS: PaymentItemFormRow[] = [];

export function PaymentItemForm({
  saleOrderId,
  value,
  paymentAmount,
  onChange,
  disabled,
  error,
  autoPopulate = false,
}: PaymentItemFormProps): JSX.Element {
  const { mode } = useFormMode();
  const isView = mode === 'view';

  // 数据契约防护：null/undefined 归一化为稳定空数组；非数组对象视为契约异常，
  // 局部报错而不是无声转空（异常单据看似正常后被覆盖）。
  const valueIsInvalid = value != null && !Array.isArray(value);
  const rows = valueIsInvalid ? EMPTY_PAYMENT_ITEM_ROWS : (value ?? EMPTY_PAYMENT_ITEM_ROWS);

  const [products, setProducts] = useState<OrderProductOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const previousSaleOrderIdRef = useRef(saleOrderId ?? null);
  const onChangeRef = useRef(onChange);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  // 拉 saleOrder.products 作产品下拉；新建回款切换合同时同步重置并带入产品行。
  // 只读模式不请求：展示用的是持久化快照，不把读取订单候选项成功作为展示前提。
  useEffect(() => {
    const currentSaleOrderId = saleOrderId ?? null;
    const shouldAutoPopulate =
      !isView && autoPopulate && previousSaleOrderIdRef.current !== currentSaleOrderId;
    previousSaleOrderIdRef.current = currentSaleOrderId;

    if (isView) {
      setProducts([]);
      setLoading(false);
      setFetchError(null);
      return;
    }

    if (!saleOrderId) {
      setProducts([]);
      if (shouldAutoPopulate) onChangeRef.current([]);
      return;
    }

    if (shouldAutoPopulate) onChangeRef.current([]);

    let cancelled = false;
    setLoading(true);
    setFetchError(null);
    api
      .get<ISaleOrderResponse>(`/sale-orders/${saleOrderId}`)
      .then((res) => {
        if (cancelled) return;
        const items = (res.data?.products ?? []).map((p) => ({
          id: p.id,
          productName: p.productName,
          subtotalAmount: p.subtotalAmount == null ? null : String(p.subtotalAmount),
        }));
        setProducts(items);
        if (shouldAutoPopulate) {
          onChangeRef.current(createPaymentItemRowsFromSaleOrderProducts(items));
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setFetchError(err instanceof Error ? err.message : '加载订单产品失败');
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [autoPopulate, isView, saleOrderId]);

  // 实时计算总额校验
  const sum = useMemo(() => rows.reduce((acc, it) => acc + Number(it.amount || 0), 0), [rows]);
  const diff = useMemo(() => sum - Number(paymentAmount || 0), [sum, paymentAmount]);
  const aligned = Math.abs(diff) < 0.01 && rows.length > 0;

  const addRow = (): void => {
    onChange([...rows, createEmptyPaymentItemRow()]);
  };

  const updateRow = (tempId: string, patch: Partial<PaymentItemFormRow>): void => {
    onChange(
      rows.map((row) =>
        row.tempId === tempId
          ? {
              ...row,
              ...patch,
              // 选了产品时同步 productName 快照
              ...(patch.saleOrderProductId
                ? {
                    productName:
                      products.find((p) => p.id === patch.saleOrderProductId)?.productName ?? '',
                    financeSubjectId: null,
                  }
                : {}),
            }
          : row
      )
    );
  };

  const removeRow = (tempId: string): void => {
    onChange(rows.filter((row) => row.tempId !== tempId));
  };

  // 一键填满：剩余金额加到最后一行（便于「N-1 个固定 + 1 个差额」场景）
  const fillRemaining = (): void => {
    if (rows.length === 0) return;
    const target = Number(paymentAmount || 0);
    const sumExceptLast = rows.slice(0, -1).reduce((acc, it) => acc + Number(it.amount || 0), 0);
    const lastAmount = Number((target - sumExceptLast).toFixed(2));
    if (lastAmount < 0) return;
    const lastRow = rows[rows.length - 1]!;
    onChange([...rows.slice(0, -1), { ...lastRow, amount: lastAmount }]);
  };

  const interactiveDisabled = disabled || isView;

  if (valueIsInvalid) {
    return (
      <div className="space-y-3 rounded-md border border-gray-200 p-3">
        <h4 className="text-sm font-medium">回款拆分（按产品 × 模式）</h4>
        <p className="text-xs text-red-600" role="alert">
          拆分明细数据格式异常（非数组），请刷新重试；问题持续请联系管理员。
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3 rounded-md border border-gray-200 p-3">
      <div className="flex items-center justify-between">
        <div>
          <h4 className="text-sm font-medium">回款拆分（按产品 × 模式）</h4>
          <p className="text-xs text-gray-500">
            v2.2：把这笔回款拆到具体订单产品行。每行可选「直收/钉钉代收/过单实收」。
          </p>
        </div>
        {!isView && (
          <div className="flex gap-2">
            {rows.length > 0 && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={fillRemaining}
                disabled={interactiveDisabled}
              >
                差额补到最后一行
              </Button>
            )}
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={addRow}
              disabled={interactiveDisabled || !saleOrderId}
            >
              <Plus className="mr-1 h-4 w-4" />
              添加一行
            </Button>
          </div>
        )}
      </div>

      {!isView && !saleOrderId && (
        <p className="text-xs text-amber-600">请先选择合同订单后再录入拆分明细。</p>
      )}
      {loading && <p className="text-xs text-gray-500">加载订单产品中...</p>}
      {fetchError && <p className="text-xs text-red-600">订单产品加载失败：{fetchError}</p>}

      {rows.length === 0 && isView ? (
        <p className="text-xs text-gray-500">未记录产品拆分明细</p>
      ) : rows.length > 0 ? (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[35%]">产品</TableHead>
              <TableHead className="w-[15%]">金额</TableHead>
              <TableHead className="w-[30%]">收款模式</TableHead>
              <TableHead className="w-[20%]">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.tempId}>
                <TableCell>
                  {isView ? (
                    <span className="text-sm">{row.productName || '-'}</span>
                  ) : (
                    <Select
                      options={products.map((p) => ({
                        value: p.id,
                        label: p.productName + (p.subtotalAmount ? `（¥${p.subtotalAmount}）` : ''),
                      }))}
                      value={row.saleOrderProductId || null}
                      onChange={(v) => updateRow(row.tempId, { saleOrderProductId: v ?? '' })}
                      disabled={interactiveDisabled}
                      placeholder="请选择产品"
                    />
                  )}
                </TableCell>
                <TableCell>
                  {isView ? (
                    <span className="text-sm">{Number(row.amount || 0).toFixed(2)}</span>
                  ) : (
                    <Input
                      type="number"
                      step="0.01"
                      value={row.amount === 0 && !row.saleOrderProductId ? '' : row.amount}
                      onChange={(e) =>
                        updateRow(row.tempId, { amount: Number(e.target.value || 0) })
                      }
                      disabled={interactiveDisabled}
                    />
                  )}
                </TableCell>
                <TableCell>
                  {isView ? (
                    <span className="text-sm">{paymentModeLabel(row.paymentMode)}</span>
                  ) : (
                    <Select
                      options={PAYMENT_MODE_OPTIONS}
                      value={row.paymentMode}
                      onChange={(v) =>
                        updateRow(row.tempId, { paymentMode: v ?? PAYMENT_MODE.DIRECT })
                      }
                      disabled={interactiveDisabled}
                    />
                  )}
                </TableCell>
                <TableCell>
                  {!isView && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => removeRow(row.tempId)}
                      disabled={interactiveDisabled}
                    >
                      <Trash2 className="h-4 w-4 text-red-500" />
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : null}

      {/* 金额加总校验（只读态仅展示合计，不显示录入校验提示） */}
      <div className="flex items-center justify-between rounded bg-gray-50 px-3 py-2 text-sm">
        <div className="text-gray-600">
          拆分合计：<span className="font-mono font-medium">¥{sum.toFixed(2)}</span>
          {' / 回款金额：'}
          <span className="font-mono font-medium">¥{Number(paymentAmount || 0).toFixed(2)}</span>
        </div>
        {!isView && (
          <div>
            {rows.length === 0 ? (
              <span className="text-xs text-red-600">至少需要一条拆分明细</span>
            ) : aligned ? (
              <span className="text-xs text-green-600">✓ 已对齐</span>
            ) : (
              <span className="text-xs text-red-600">
                差额 ¥{diff.toFixed(2)}（误差 ≥ 0.01 提交会被拒）
              </span>
            )}
          </div>
        )}
      </div>

      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
