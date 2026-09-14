import { APPROVAL_EVENT_TYPE } from '@ky-azeroth/shared/constants';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ApprovalPanel,
  getSaleOrderChangeDetails,
  isSaleOrderChangeDetailMissing,
} from '../approval-panel';

const mocks = vi.hoisted(() => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
}));

vi.mock('@/lib/api', () => ({
  api: {
    get: mocks.apiGet,
    post: mocks.apiPost,
  },
  getErrorMessage: (error: unknown) => (error instanceof Error ? error.message : '操作失败'),
}));

vi.mock('@/lib/approval-permissions', () => ({
  computeApprovalPermissions: () => ({
    canApprove: true,
    canApproveAsNormal: true,
    canApproveAsAdmin: false,
    canWithdraw: false,
  }),
}));

vi.mock('@/stores/auth', () => ({
  useAuthStore: () => ({
    user: { id: 'employee-1', employee: { id: 'employee-1' } },
    getPermissions: () => [],
  }),
}));

function saleOrderChangeRequest(beforeProducts: unknown[], afterProducts: unknown[]) {
  return {
    eventType: APPROVAL_EVENT_TYPE.SALE_ORDER_CHANGE,
    patch: { products: afterProducts },
    beforeSnapshot: { products: beforeProducts },
    afterSnapshot: { products: afterProducts },
  } as never;
}

function saleOrderInstance(id: string, status: 'pending' | 'withdrawn', code: string) {
  return {
    id,
    status,
    code,
    eventType: APPROVAL_EVENT_TYPE.SALE_ORDER_CHANGE,
    formId: 'change-request-1',
    title: '合同订单变更审批',
    initiatorName: '销售',
    createdAt: '2026-09-02T10:00:00.000Z',
    currentNode: 1,
    totalNodes: 1,
    tasks: [],
    records: [],
  } as never;
}

describe('订单变更审批产品明细', () => {
  it('同数量产品修改名称、数量或合同单价时展示内容级对比，且允许审批', () => {
    const details = getSaleOrderChangeDetails(
      saleOrderChangeRequest(
        [
          {
            productName: '钉钉专业版',
            productNumber: 'DING-PRO',
            quantity: 1,
            productPrice: 200,
            unitPrice: 120,
            contractUnitPrice: 100,
          },
        ],
        [
          {
            productName: '钉钉旗舰版',
            productNumber: 'DING-PRO',
            quantity: 2,
            productPrice: 200,
            unitPrice: 120,
            contractUnitPrice: 150,
          },
        ]
      )
    );

    expect(details).toEqual([
      {
        field: '产品明细',
        before: '第 1 项：钉钉专业版（DING-PRO），数量 1，产品单价 200，单价 120，合同单价 100',
        after: '第 1 项：钉钉旗舰版（DING-PRO），数量 2，产品单价 200，单价 120，合同单价 150',
      },
    ]);
    expect(isSaleOrderChangeDetailMissing(APPROVAL_EVENT_TYPE.SALE_ORDER_CHANGE, details)).toBe(
      false
    );
  });

  it('展示订单费用与备注的字段级变更', () => {
    expect(
      getSaleOrderChangeDetails({
        eventType: APPROVAL_EVENT_TYPE.SALE_ORDER_CHANGE,
        patch: { otherFee: 345, remark: '赠送一台考勤机' },
        beforeSnapshot: { otherFee: 0, remark: null },
        afterSnapshot: { otherFee: 345, remark: '赠送一台考勤机' },
      } as never)
    ).toEqual([
      { field: '其他费用', before: '0', after: '345' },
      { field: '备注', before: '未填写', after: '赠送一台考勤机' },
    ]);
  });

  it('仅 products 变化时保留变更明细；完全相同的产品明细才禁止通过', () => {
    const beforeProducts = [
      {
        productName: '定制开发',
        productNumber: 'DEV',
        quantity: 1,
        unitPrice: 1000,
        contractUnitPrice: 900,
      },
    ];
    const changedDetails = getSaleOrderChangeDetails(
      saleOrderChangeRequest(beforeProducts, [
        {
          ...beforeProducts[0],
          contractUnitPrice: 800,
        },
      ])
    );
    const unchangedDetails = getSaleOrderChangeDetails(
      saleOrderChangeRequest(beforeProducts, beforeProducts)
    );

    expect(changedDetails).toHaveLength(1);
    expect(
      isSaleOrderChangeDetailMissing(APPROVAL_EVENT_TYPE.SALE_ORDER_CHANGE, changedDetails)
    ).toBe(false);
    expect(unchangedDetails).toEqual([]);
    expect(
      isSaleOrderChangeDetailMissing(APPROVAL_EVENT_TYPE.SALE_ORDER_CHANGE, unchangedDetails)
    ).toBe(true);
  });
});

describe('订单变更审批自动切换', () => {
  beforeEach(() => {
    mocks.apiGet.mockReset();
    mocks.apiPost.mockReset();
  });

  it('变更申请没有有效 diff 时保留审批信息并禁用通过', async () => {
    mocks.apiGet.mockImplementation(async (url: string) => {
      if (url === '/approvals/no-diff-instance') {
        return { data: saleOrderInstance('no-diff-instance', 'pending', 'NO-DIFF-1') };
      }
      if (url === '/approvals/change-requests/change-request-1') {
        return {
          data: {
            eventType: APPROVAL_EVENT_TYPE.SALE_ORDER_CHANGE,
            patch: {},
            beforeSnapshot: {},
            afterSnapshot: {},
          },
        };
      }
      throw new Error(`未预期的请求：${url}`);
    });

    render(<ApprovalPanel instanceId="no-diff-instance" />);

    await screen.findByText('NO-DIFF-1');
    expect(screen.getByText('未读取到有效的订单变更明细，不能继续审批。')).toBeTruthy();
    expect((screen.getByRole('button', { name: '通过' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: '驳回' }) as HTMLButtonElement).disabled).toBe(
      false
    );
  });

  it('变更明细加载失败时保留审批信息、拒绝与重新加载入口', async () => {
    mocks.apiGet.mockImplementation(async (url: string) => {
      if (url === '/approvals/broken-instance') {
        return { data: saleOrderInstance('broken-instance', 'pending', 'BROKEN-1') };
      }
      if (url === '/approvals/change-requests/change-request-1') {
        throw new Error('变更申请不存在');
      }
      throw new Error(`未预期的请求：${url}`);
    });

    render(<ApprovalPanel instanceId="broken-instance" />);

    await screen.findByText('BROKEN-1');
    expect(
      screen.getByText('变更明细加载失败，无法通过当前审批；你仍可驳回或重新加载。')
    ).toBeTruthy();
    expect((screen.getByRole('button', { name: '通过' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: '驳回' }) as HTMLButtonElement).disabled).toBe(
      false
    );

    fireEvent.click(screen.getByRole('button', { name: '驳回' }));
    fireEvent.click(await screen.findByRole('button', { name: '确认' }));
    await waitFor(() =>
      expect(mocks.apiPost).toHaveBeenCalledWith('/approvals/broken-instance/approve', {
        action: 'reject',
        comment: undefined,
      })
    );

    fireEvent.click(screen.getByRole('button', { name: '重新加载变更明细' }));
    await waitFor(() => expect(mocks.apiGet).toHaveBeenCalledTimes(7));
  });

  it('旧审批在打开后被重新提交替代，点击通过会切换到最新审批', async () => {
    let oldInstanceReadCount = 0;
    let oldChangeRequestReadCount = 0;
    mocks.apiGet.mockImplementation(async (url: string) => {
      if (url === '/approvals/old-instance') {
        oldInstanceReadCount += 1;
        return {
          data:
            oldInstanceReadCount === 1
              ? saleOrderInstance('old-instance', 'pending', 'OLD-1')
              : saleOrderInstance('old-instance', 'withdrawn', 'OLD-1'),
        };
      }
      if (url === '/approvals/change-requests/change-request-1') {
        oldChangeRequestReadCount += 1;
        return {
          data: {
            eventType: APPROVAL_EVENT_TYPE.SALE_ORDER_CHANGE,
            patch:
              oldChangeRequestReadCount === 1
                ? { products: [{ productName: '新产品' }] }
                : { __latestApprovalInstanceId: 'new-instance' },
            beforeSnapshot: { products: [] },
            afterSnapshot: {
              products: oldChangeRequestReadCount === 1 ? [{ productName: '新产品' }] : [],
            },
          },
        };
      }
      if (url === '/approvals/new-instance') {
        return { data: saleOrderInstance('new-instance', 'pending', 'NEW-1') };
      }
      throw new Error(`未预期的请求：${url}`);
    });

    render(<ApprovalPanel instanceId="old-instance" />);

    await screen.findByText('OLD-1');
    await waitFor(() =>
      expect((screen.getByRole('button', { name: '通过' }) as HTMLButtonElement).disabled).toBe(
        false
      )
    );
    fireEvent.click(screen.getByRole('button', { name: '通过' }));
    fireEvent.click(await screen.findByRole('button', { name: '确认' }));

    await waitFor(() => expect(screen.getByText('NEW-1')).toBeTruthy());
    expect(mocks.apiGet).toHaveBeenCalledWith('/approvals/new-instance');
  });
});
