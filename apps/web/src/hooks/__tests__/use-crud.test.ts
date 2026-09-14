import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { api, batchDelete } from '@/lib/api';

import { useCrud } from '../use-crud';

const refresh = vi.fn();
const toastError = vi.fn();
const toastSuccess = vi.fn();
const toastWarning = vi.fn();

vi.mock('sonner', () => ({
  toast: {
    error: (message: string) => toastError(message),
    success: (message: string) => toastSuccess(message),
    warning: (message: string) => toastWarning(message),
  },
}));

vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api');
  return {
    ...actual,
    api: {
      post: vi.fn(),
      put: vi.fn(),
      delete: vi.fn(),
    },
    batchDelete: vi.fn(),
  };
});

vi.mock('../use-server-pagination', () => ({
  useServerPagination: vi.fn(() => ({
    data: [
      { id: '1', name: '原始', version: 11 },
      { id: '2', name: '第二条', version: 12 },
    ],
    loading: false,
    error: null,
    pagination: { page: 1, pageSize: 100, total: 2, totalPages: 1 },
    sorting: {},
    refresh,
    reset: vi.fn(),
    loadData: vi.fn(),
  })),
}));

interface Entity {
  id: string;
  name: string;
  version?: number;
}

interface FormData {
  name: string;
  version?: number;
}

const schema = z.object({
  name: z.string().min(2, '名称至少 2 个字符'),
  version: z.number().optional(),
});

function renderCrud() {
  return renderHook(() =>
    useCrud<Entity, FormData>({
      endpoint: '/entities',
      initialFormData: { name: '' },
      schema,
      entityToForm: (entity) => ({ name: entity.name, version: entity.version }),
      formToPayload: (form) => ({ name: form.name.trim(), version: form.version }),
    })
  );
}

function renderRequiredVersionCrud(
  customUpdate?: NonNullable<Parameters<typeof useCrud<Entity, FormData>>[0]['customUpdate']>
) {
  return renderHook(() =>
    useCrud<Entity, FormData>({
      endpoint: '/entities',
      initialFormData: { name: '' },
      schema,
      entityToForm: (entity) => ({ name: entity.name, version: entity.version }),
      formToPayload: (form) => ({ name: form.name.trim(), version: form.version }),
      requireVersion: true,
      customUpdate,
    })
  );
}

describe('useCrud', () => {
  beforeEach(() => {
    vi.mocked(api.post).mockReset();
    vi.mocked(api.put).mockReset();
    vi.mocked(api.delete).mockReset();
    refresh.mockReset();
    toastError.mockReset();
    toastSuccess.mockReset();
    toastWarning.mockReset();
    vi.mocked(batchDelete).mockReset();
  });

  it('提供可直接传给 CrudTable 的统一 tableProps', () => {
    const { result } = renderCrud();

    expect(result.current.tableProps).toEqual({
      loading: false,
      error: null,
      onRetry: refresh,
      stale: false,
    });
  });

  it('创建弹窗会重置表单并在 schema 失败时阻止提交', async () => {
    const { result } = renderCrud();

    act(() => result.current.openCreateDialog());
    expect(result.current.formDialogProps.mode).toBe('create');

    await act(async () => {
      const ok = await result.current.handleSubmit();
      expect(ok).toBe(false);
    });

    expect(api.post).not.toHaveBeenCalled();
    expect(result.current.getFieldError('name')).toBe('名称至少 2 个字符');
    expect(toastError).toHaveBeenCalledWith('名称至少 2 个字符');
  });

  it('创建成功时转换 payload、关闭弹窗并刷新列表', async () => {
    vi.mocked(api.post).mockResolvedValueOnce({ data: { id: '2', name: '新建' } });
    const { result } = renderCrud();

    act(() => result.current.openCreateDialog());
    act(() => result.current.updateFormField('name', ' 新建 '));

    await act(async () => {
      const ok = await result.current.handleSubmit();
      expect(ok).toBe(true);
    });

    expect(api.post).toHaveBeenCalledWith('/entities', { name: '新建', version: undefined });
    expect(toastSuccess).toHaveBeenCalledWith('创建成功');
    expect(refresh).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(result.current.dialogOpen).toBe(false));
  });

  it('编辑成功时使用 PUT 并保留 version', async () => {
    vi.mocked(api.put).mockResolvedValueOnce({ data: { id: '1', name: '更新' } });
    const { result } = renderCrud();

    act(() => result.current.openEditDialog({ id: '1', name: ' 旧名称 ', version: 7 }));
    act(() => result.current.updateFormField('name', ' 更新 '));

    await act(async () => {
      const ok = await result.current.handleSubmit();
      expect(ok).toBe(true);
    });

    expect(api.put).toHaveBeenCalledWith('/entities/1', { name: '更新', version: 7 });
    expect(toastSuccess).toHaveBeenCalledWith('更新成功');
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('删除时把整数 version 追加到 query，保障乐观锁路径', async () => {
    vi.mocked(api.delete).mockResolvedValueOnce({ data: { success: true } });
    const { result } = renderCrud();

    act(() => result.current.openDeleteDialog({ id: '1', name: '待删', version: 9 }));
    await act(async () => {
      const ok = await result.current.handleDelete();
      expect(ok).toBe(true);
    });

    expect(api.delete).toHaveBeenCalledWith('/entities/1?version=9');
    expect(toastSuccess).toHaveBeenCalledWith('删除成功');
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it.each([undefined, 0, Number.NaN])(
    'required-version 表单更新在 version=%s 时 strict no-request（含 customUpdate）',
    async (version) => {
      const customUpdate = vi.fn().mockResolvedValue(undefined);
      const { result } = renderRequiredVersionCrud(customUpdate);

      act(() => result.current.openEditDialog({ id: '1', name: '旧名称', version }));
      await act(async () => {
        const ok = await result.current.handleSubmit();
        expect(ok).toBe(false);
      });

      expect(customUpdate).not.toHaveBeenCalled();
      expect(api.put).not.toHaveBeenCalled();
      expect(result.current.submitLoading).toBe(false);
      expect(toastError).toHaveBeenCalled();
    }
  );

  it.each([undefined, 0, Number.NaN])(
    'required-version 公开 update() 在 version=%s 时不进入 loading 且不发 PUT',
    async (version) => {
      const { result } = renderRequiredVersionCrud();

      await act(async () => {
        const updated = await result.current.update('1', { name: '新名称', version });
        expect(updated).toBeNull();
      });

      expect(api.put).not.toHaveBeenCalled();
      expect(result.current.submitLoading).toBe(false);
      expect(toastError).toHaveBeenCalled();
    }
  );

  it('required-version 单删缺版时不进入 loading 且不发 DELETE', async () => {
    const { result } = renderRequiredVersionCrud();

    act(() => result.current.openDeleteDialog({ id: '1', name: '待删' }));
    await act(async () => {
      const ok = await result.current.handleDelete();
      expect(ok).toBe(false);
    });

    expect(api.delete).not.toHaveBeenCalled();
    expect(result.current.deleteLoading).toBe(false);
    expect(toastError).toHaveBeenCalledWith('数据版本缺失或无效，请刷新后重试');
  });

  it('required-version 批删要求 ids 与 version map 精确一一对应，否则不调用 batchDelete', async () => {
    const { result } = renderRequiredVersionCrud();

    act(() => result.current.setSelectedKeys(new Set(['1', 'missing-row'])));
    await act(async () => {
      const ok = await result.current.handleBulkDelete();
      expect(ok).toBe(false);
    });

    expect(batchDelete).not.toHaveBeenCalled();
    expect(result.current.bulkDeleteLoading).toBe(false);
    expect(toastError).toHaveBeenCalledWith('数据版本缺失或无效，请刷新后重试');
  });

  it('批量删除 0 条成功时显示失败，不再弹绿色成功提示', async () => {
    vi.mocked(batchDelete).mockResolvedValueOnce({
      success: 0,
      failed: 2,
      errors: [
        { id: '1', error: '合同订单已审批通过，请发起作废审批' },
        { id: '2', error: '合同订单已审批通过，请发起作废审批' },
      ],
    });
    const { result } = renderCrud();

    act(() => result.current.setSelectedKeys(new Set(['1', '2'])));
    await act(async () => {
      const ok = await result.current.handleBulkDelete();
      expect(ok).toBe(false);
    });

    expect(batchDelete).toHaveBeenCalledWith('/entities', ['1', '2'], {
      versions: { '1': 11, '2': 12 },
    });
    expect(toastError).toHaveBeenCalledWith('未删除任何记录：合同订单已审批通过，请发起作废审批');
    expect(toastSuccess).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });

  it('批量删除部分成功时显示警告并刷新列表', async () => {
    vi.mocked(batchDelete).mockResolvedValueOnce({
      success: 1,
      failed: 1,
      errors: [{ id: '2', error: '记录审批中，请先撤回审批' }],
    });
    const { result } = renderCrud();

    act(() => result.current.setSelectedKeys(new Set(['1', '2'])));
    await act(async () => {
      const ok = await result.current.handleBulkDelete();
      expect(ok).toBe(true);
    });

    expect(toastWarning).toHaveBeenCalledWith('成功删除 1 项，跳过 1 项：记录审批中，请先撤回审批');
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});
